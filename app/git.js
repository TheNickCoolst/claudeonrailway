import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export const DEFAULT_PROJECTS_DIR = process.env.DEV_PROJECTS_DIR || (
  process.env.HOME ? path.join(process.env.HOME, 'projects') : '/home/dev/projects'
);

/**
 * Run git command inside a project directory
 */
export async function gitExec(args, cwd, env = {}) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      env: { ...process.env, ...env },
      maxBuffer: 10 * 1024 * 1024,
    });
    return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    return {
      success: false,
      stdout: err.stdout ? String(err.stdout).trim() : '',
      stderr: err.stderr ? String(err.stderr).trim() : err.message,
      code: err.code || 1,
    };
  }
}

/**
 * List all project repositories in the base directory
 */
export async function listProjects(baseDir = DEFAULT_PROJECTS_DIR) {
  try {
    await fs.mkdir(baseDir, { recursive: true });
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    const projects = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectPath = path.join(baseDir, entry.name);
      const gitDir = path.join(projectPath, '.git');

      try {
        await fs.access(gitDir);
        // It is a git repo
        const branchRes = await gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], projectPath);
        const statusRes = await gitExec(['status', '--porcelain'], projectPath);
        const commitRes = await gitExec(['log', '-1', '--format=%h|%s|%cr|%an'], projectPath);
        const remoteRes = await gitExec(['remote', 'get-url', 'origin'], projectPath);

        let lastCommit = null;
        if (commitRes.success && commitRes.stdout) {
          const [hash, subject, time, author] = commitRes.stdout.split('|');
          lastCommit = { hash, subject, time, author };
        }

        const changesCount = statusRes.success && statusRes.stdout
          ? statusRes.stdout.split('\n').filter(Boolean).length
          : 0;

        projects.push({
          name: entry.name,
          path: projectPath,
          branch: branchRes.success ? branchRes.stdout : 'unknown',
          remoteUrl: remoteRes.success ? remoteRes.stdout : '',
          isDirty: changesCount > 0,
          changesCount,
          lastCommit,
        });
      } catch {
        // Not a git repo, or permission issue
        projects.push({
          name: entry.name,
          path: projectPath,
          branch: null,
          remoteUrl: null,
          isDirty: false,
          changesCount: 0,
          lastCommit: null,
        });
      }
    }

    return projects;
  } catch (err) {
    console.error('[git:listProjects] Error:', err);
    return [];
  }
}

/**
 * Get detailed status for a single project
 */
export async function getProjectStatus(projectPath) {
  const branchRes = await gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], projectPath);
  const statusRes = await gitExec(['status', '--porcelain=v1'], projectPath);
  const remoteRes = await gitExec(['remote', 'get-url', 'origin'], projectPath);
  const logRes = await gitExec(['log', '-10', '--format=%h|%s|%cr|%an'], projectPath);

  const changedFiles = [];
  if (statusRes.success && statusRes.stdout) {
    for (const line of statusRes.stdout.split('\n').filter(Boolean)) {
      const code = line.slice(0, 2);
      const filePath = line.slice(3).trim();
      let status = 'modified';
      if (code.includes('?')) status = 'untracked';
      else if (code.includes('A')) status = 'added';
      else if (code.includes('D')) status = 'deleted';
      else if (code.includes('R')) status = 'renamed';
      changedFiles.push({ code: code.trim(), path: filePath, status });
    }
  }

  const recentCommits = [];
  if (logRes.success && logRes.stdout) {
    for (const line of logRes.stdout.split('\n').filter(Boolean)) {
      const [hash, subject, time, author] = line.split('|');
      recentCommits.push({ hash, subject, time, author });
    }
  }

  return {
    path: projectPath,
    name: path.basename(projectPath),
    branch: branchRes.success ? branchRes.stdout : 'unknown',
    remoteUrl: remoteRes.success ? remoteRes.stdout : '',
    changedFiles,
    isDirty: changedFiles.length > 0,
    recentCommits,
  };
}

/**
 * Get unified git diff for active changes in project
 */
export async function getProjectDiff(projectPath) {
  const stagedRes = await gitExec(['diff', '--cached'], projectPath);
  const unstagedRes = await gitExec(['diff'], projectPath);
  const untrackedRes = await gitExec(['ls-files', '--others', '--exclude-standard'], projectPath);

  let untrackedDiff = '';
  if (untrackedRes.success && untrackedRes.stdout) {
    const files = untrackedRes.stdout.split('\n').filter(Boolean);
    for (const file of files.slice(0, 20)) { // limit preview
      try {
        const filePath = path.join(projectPath, file);
        const stat = await fs.stat(filePath);
        if (stat.size > 1024 * 1024) {
          untrackedDiff += `\n--- /dev/null\n+++ b/${file} (file too large for diff preview: ${(stat.size / 1024 / 1024).toFixed(1)}MB)\n`;
          continue;
        }
        const content = await fs.readFile(filePath, 'utf8');
        untrackedDiff += `\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${content.split('\n').length} @@\n`;
        untrackedDiff += content.split('\n').map((l) => `+${l}`).join('\n') + '\n';
      } catch {
        untrackedDiff += `\n--- /dev/null\n+++ b/${file} (binary or unreadable)\n`;
      }
    }
  }

  const combinedDiff = [
    stagedRes.stdout ? `# Staged Changes:\n${stagedRes.stdout}` : '',
    unstagedRes.stdout ? `# Unstaged Changes:\n${unstagedRes.stdout}` : '',
    untrackedDiff ? `# Untracked Files:\n${untrackedDiff}` : '',
  ].filter(Boolean).join('\n\n');

  return {
    diff: combinedDiff,
    hasChanges: Boolean(stagedRes.stdout || unstagedRes.stdout || untrackedDiff),
  };
}

/**
 * Clone a GitHub repository into the projects directory
 */
export async function cloneRepository({ repo, branch, baseDir = DEFAULT_PROJECTS_DIR }) {
  await fs.mkdir(baseDir, { recursive: true });

  let cloneUrl = repo.trim();
  let folderName = '';

  // Handle owner/repo format: e.g. "octocat/hello-world"
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(cloneUrl)) {
    folderName = cloneUrl.split('/')[1].replace(/\.git$/, '');
    cloneUrl = `https://github.com/${cloneUrl}`;
  } else {
    // Normal URL
    const urlMatch = cloneUrl.match(/\/([^/]+?)(?:\.git)?$/);
    folderName = urlMatch ? urlMatch[1] : `repo-${Date.now()}`;
  }

  const targetPath = path.join(baseDir, folderName);

  // Check if directory already exists
  try {
    await fs.access(targetPath);
    return {
      success: false,
      error: `Directory "${folderName}" already exists in ${baseDir}`,
      path: targetPath,
    };
  } catch {
    // Does not exist, good
  }

  const args = ['clone', cloneUrl, targetPath];
  if (branch) {
    args.splice(1, 0, '-b', branch);
  }

  console.log(`[git:clone] Cloning ${cloneUrl} into ${targetPath}...`);
  const res = await gitExec(args, baseDir);

  if (!res.success) {
    return {
      success: false,
      error: res.stderr || 'Git clone failed',
      stdout: res.stdout,
      stderr: res.stderr,
    };
  }

  return {
    success: true,
    name: folderName,
    path: targetPath,
    stdout: res.stdout,
  };
}

/**
 * Commit all changes and push to GitHub
 */
export async function commitAndPush({ projectPath, message, branch }) {
  if (!message || !message.trim()) {
    throw new Error('Commit message cannot be empty');
  }

  // 1. Stage all changes
  const addRes = await gitExec(['add', '-A'], projectPath);
  if (!addRes.success) {
    return { success: false, step: 'git add', error: addRes.stderr };
  }

  // 2. Commit
  const commitRes = await gitExec(['commit', '-m', message.trim()], projectPath);
  if (!commitRes.success) {
    // Check if nothing to commit
    if (commitRes.stdout.includes('nothing to commit') || commitRes.stderr.includes('nothing to commit')) {
      return { success: false, step: 'git commit', error: 'Nothing to commit: working tree is clean.' };
    }
    return { success: false, step: 'git commit', error: commitRes.stderr || commitRes.stdout };
  }

  // 3. Determine branch
  let targetBranch = branch;
  if (!targetBranch) {
    const curBranchRes = await gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], projectPath);
    targetBranch = curBranchRes.success ? curBranchRes.stdout : 'HEAD';
  }

  // 4. Push to remote origin
  console.log(`[git:push] Pushing to origin ${targetBranch}...`);
  const pushRes = await gitExec(['push', '-u', 'origin', targetBranch], projectPath);
  if (!pushRes.success) {
    return {
      success: false,
      step: 'git push',
      error: pushRes.stderr || pushRes.stdout || 'Failed to push to GitHub',
    };
  }

  // Get new commit hash
  const hashRes = await gitExec(['rev-parse', '--short', 'HEAD'], projectPath);
  const commitHash = hashRes.success ? hashRes.stdout : '';

  return {
    success: true,
    commitHash,
    branch: targetBranch,
    output: `${commitRes.stdout}\n${pushRes.stderr || pushRes.stdout}`.trim(),
  };
}
