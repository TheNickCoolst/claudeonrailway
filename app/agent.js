import { query } from '@anthropic-ai/claude-agent-sdk';
import Anthropic from '@anthropic-ai/sdk';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

/**
 * Run an agent task using @anthropic-ai/claude-agent-sdk
 * Streams events via onEvent callback
 */
export async function runAgentTask({
  prompt,
  cwd,
  onEvent,
  abortController = new AbortController(),
  model = process.env.ANTHROPIC_MODEL,
}) {
  onEvent({ type: 'start', prompt, cwd });

  try {
    // Configure options for Claude Agent SDK
    const options = {
      cwd,
      abortController,
      permissionMode: 'acceptEdits',
      allowedTools: [
        'Bash',
        'Read',
        'Edit',
        'Write',
        'Glob',
        'Grep',
      ],
      env: {
        ...process.env,
        // Gateway URL proxy settings
        ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || 'http://127.0.0.1:8787/anthropic',
        ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN || 'managed-by-gateway',
        CLAUDE_AGENT_SDK_CLIENT_APP: 'claude-dev-studio/1.0',
      },
    };
    if (model) options.model = model;

    console.log(`[agent:run] Starting Claude Agent SDK query in ${cwd}...`);
    const q = query({ prompt, options });

    for await (const message of q) {
      if (abortController.signal.aborted) {
        onEvent({ type: 'aborted', message: 'Task stopped by user' });
        return;
      }

      // Handle different SDK message types
      if (message.type === 'assistant') {
        const contentList = message.message?.content || [];
        for (const item of contentList) {
          if (item.type === 'text') {
            onEvent({ type: 'text', text: item.text });
          } else if (item.type === 'tool_use') {
            onEvent({
              type: 'tool_call',
              id: item.id,
              name: item.name,
              input: item.input,
            });
          }
        }
      } else if (message.type === 'user') {
        // Tool results
        const contentList = message.message?.content || [];
        for (const item of contentList) {
          if (item.type === 'tool_result') {
            onEvent({
              type: 'tool_result',
              id: item.tool_use_id,
              content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content),
              isError: Boolean(item.is_error),
            });
          }
        }
      } else if (message.type === 'status') {
        onEvent({
          type: 'status',
          status: message.status,
          description: message.description || '',
        });
      } else if (message.type === 'result') {
        onEvent({
          type: 'complete',
          result: message.result || '',
          usage: message.usage || null,
        });
        return;
      }
    }

    onEvent({ type: 'complete', result: 'Task finished' });
  } catch (err) {
    if (abortController.signal.aborted) {
      onEvent({ type: 'aborted', message: 'Task stopped by user' });
      return;
    }

    console.warn(`[agent:run] Claude Agent SDK encountered error: ${err.message}. Trying direct Anthropic SDK fallback...`);
    onEvent({
      type: 'warning',
      message: `Claude Agent SDK runtime note: ${err.message}. Falling back to Anthropic Client SDK runner.`,
    });

    // Fallback to direct Anthropic Client SDK tool-calling loop
    try {
      await runAnthropicClientLoop({ prompt, cwd, onEvent, abortController, model });
    } catch (fallbackErr) {
      console.error('[agent:run] Fallback runner error:', fallbackErr);
      onEvent({ type: 'error', error: fallbackErr.message });
    }
  }
}

/**
 * Fallback runner using @anthropic-ai/sdk directly with tool calling loop
 * Ensures 100% operation even if native CLI binary is not bundled for current platform
 */
export async function runAnthropicClientLoop({
  prompt,
  cwd,
  onEvent,
  abortController,
  model = 'claude-3-7-sonnet-20250219',
}) {
  const baseURL = process.env.ANTHROPIC_BASE_URL || 'http://127.0.0.1:8787/anthropic';
  const apiKey = process.env.ANTHROPIC_API_KEY || 'managed-by-gateway';

  const client = new Anthropic({
    baseURL,
    apiKey,
  });

  const tools = [
    {
      name: 'bash',
      description: 'Run a shell command inside the project directory',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to run' },
        },
        required: ['command'],
      },
    },
    {
      name: 'read_file',
      description: 'Read the contents of a file',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file from project root' },
        },
        required: ['path'],
      },
    },
    {
      name: 'write_file',
      description: 'Create or overwrite a file with contents',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file' },
          content: { type: 'string', description: 'File content to write' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'list_files',
      description: 'List files and directories in a path',
      input_schema: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Directory path (relative or empty for root)' },
        },
      },
    },
  ];

  const systemPrompt = `You are an expert AI software engineer operating on a project in directory: ${cwd}.
Use your tools to inspect code, edit files, and run commands to complete the user's task.
When you finish all changes, explain what was done clearly and verify git status.`;

  const messages = [
    { role: 'user', content: prompt },
  ];

  let turns = 0;
  const maxTurns = 20;

  while (turns < maxTurns) {
    if (abortController.signal.aborted) {
      onEvent({ type: 'aborted', message: 'Task stopped by user' });
      return;
    }
    turns++;

    onEvent({ type: 'status', status: 'thinking', description: `Turn ${turns}...` });

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      tools,
    }, {
      signal: abortController.signal,
    });

    const toolUseBlocks = [];
    for (const block of response.content) {
      if (block.type === 'text') {
        onEvent({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        toolUseBlocks.push(block);
        onEvent({
          type: 'tool_call',
          id: block.id,
          name: block.name,
          input: block.input,
        });
      }
    }

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
      onEvent({ type: 'complete', result: 'Task completed successfully' });
      return;
    }

    // Execute tools
    const toolResults = [];
    for (const tool of toolUseBlocks) {
      let output = '';
      let isError = false;

      try {
        if (tool.name === 'bash') {
          const cmd = tool.input.command;
          try {
            const { stdout, stderr } = await execFileAsync('bash', ['-c', cmd], {
              cwd,
              timeout: 60000,
              maxBuffer: 5 * 1024 * 1024,
            });
            output = (stdout || '') + (stderr ? `\nSTDERR:\n${stderr}` : '');
            if (!output.trim()) output = '(command finished with code 0 and empty output)';
          } catch (cmdErr) {
            output = (cmdErr.stdout || '') + (cmdErr.stderr || cmdErr.message);
            isError = true;
          }
        } else if (tool.name === 'read_file') {
          const filePath = path.resolve(cwd, tool.input.path);
          output = await fs.readFile(filePath, 'utf8');
        } else if (tool.name === 'write_file') {
          const filePath = path.resolve(cwd, tool.input.path);
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, tool.input.content, 'utf8');
          output = `Successfully wrote ${tool.input.content.length} bytes to ${tool.input.path}`;
        } else if (tool.name === 'list_files') {
          const targetDir = path.resolve(cwd, tool.input.dir || '.');
          const entries = await fs.readdir(targetDir, { withFileTypes: true });
          output = entries.map((e) => `${e.isDirectory() ? '[DIR] ' : '      '}${e.name}`).join('\n');
        } else {
          output = `Unknown tool: ${tool.name}`;
          isError = true;
        }
      } catch (err) {
        output = `Error executing ${tool.name}: ${err.message}`;
        isError = true;
      }

      onEvent({
        type: 'tool_result',
        id: tool.id,
        content: output,
        isError,
      });

      toolResults.push({
        type: 'tool_result',
        tool_use_id: tool.id,
        content: output,
        is_error: isError,
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  onEvent({ type: 'complete', result: 'Reached maximum iteration limit' });
}
