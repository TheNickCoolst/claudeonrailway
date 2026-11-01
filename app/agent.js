import { query } from '@anthropic-ai/claude-agent-sdk';
import Anthropic from '@anthropic-ai/sdk';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

/**
 * Multi-Provider Catalog
 */
export const PROVIDERS = {
  claude: {
    id: 'claude',
    name: 'Claude (Anthropic)',
    badge: 'Claude SDK',
    icon: '🟣',
    defaultModel: 'claude-3-7-sonnet-20250219',
    models: [
      { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet (Hybrid Reasoning)' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku (Fast)' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
    ],
    description: 'Autonomous agent loop via official Claude Agent SDK & Anthropic SDK',
  },
  antigravity: {
    id: 'antigravity',
    name: 'Antigravity (Google / Gemini)',
    badge: 'DeepMind',
    icon: '🔵',
    defaultModel: 'gemini-2.0-flash',
    models: [
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Fast & Agentic)' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (State-of-the-Art)' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro (2M Context)' },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
    ],
    description: 'Google DeepMind & Gemini API via Antigravity proxy',
  },
  codex: {
    id: 'codex',
    name: 'Codex / OpenAI',
    badge: 'OpenAI',
    icon: '🟢',
    defaultModel: 'gpt-4o',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o (Omni Flagship)' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Fast & Lightweight)' },
      { id: 'o3-mini', name: 'o3-mini (High-speed Reasoning)' },
      { id: 'o1', name: 'o1 (Deep Reasoning)' },
    ],
    description: 'OpenAI Codex & reasoning models via OpenAI tool-calling loop',
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    badge: 'Open Ecosystem',
    icon: '🟠',
    defaultModel: 'deepseek/deepseek-chat',
    models: [
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3 (Coding Benchmark)' },
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1 (Open Reasoning)' },
      { id: 'qwen/qwen-2.5-coder-32b-instruct', name: 'Qwen 2.5 Coder 32B' },
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct' },
    ],
    description: 'Open-source coding models & local runtimes (OpenRouter, Ollama, vLLM)',
  },
  freebuff: {
    id: 'freebuff',
    name: 'Freebuff (Free Tier)',
    badge: '100% Free',
    icon: '🎁',
    defaultModel: 'freebuff-auto',
    models: [
      { id: 'freebuff-auto', name: 'Freebuff Auto (Free DeepSeek V3 / GLM-4)' },
      { id: 'freebuff-deepseek-v3', name: 'DeepSeek V3 (Freebuff Pool)' },
      { id: 'freebuff-gpt-4o-mini', name: 'GPT-4o Mini (Freebuff Pool)' },
      { id: 'freebuff-glm-4', name: 'GLM 4 9B (Freebuff Pool)' },
    ],
    description: 'Community ad-funded free AI coding model access without subscriptions or credit cards',
  },
};

/**
 * Universal Tool Schema for OpenAI-compatible Providers
 */
const OPENAI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Run a shell command inside the project directory',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to run' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file from project root' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file with contents',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file' },
          content: { type: 'string', description: 'File content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories in a path',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Directory path (relative or empty for root)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep_search',
      description: 'Search for text pattern in project files',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text or regex to search for' },
          dir: { type: 'string', description: 'Subdirectory to search in (optional)' },
        },
        required: ['query'],
      },
    },
  },
];

/**
 * Execute a workspace tool safely
 */
async function executeWorkspaceTool(name, input, cwd) {
  if (name === 'bash') {
    const cmd = input.command;
    const { stdout, stderr } = await execFileAsync('bash', ['-c', cmd], {
      cwd,
      timeout: 60000,
      maxBuffer: 5 * 1024 * 1024,
    });
    let output = (stdout || '') + (stderr ? `\nSTDERR:\n${stderr}` : '');
    if (!output.trim()) output = '(command finished with code 0 and empty output)';
    return output;
  }
  if (name === 'read_file') {
    const filePath = path.resolve(cwd, input.path);
    return await fs.readFile(filePath, 'utf8');
  }
  if (name === 'write_file') {
    const filePath = path.resolve(cwd, input.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, input.content, 'utf8');
    return `Successfully wrote ${input.content.length} bytes to ${input.path}`;
  }
  if (name === 'list_files') {
    const targetDir = path.resolve(cwd, input.dir || '.');
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    return entries.map((e) => `${e.isDirectory() ? '[DIR] ' : '      '}${e.name}`).join('\n');
  }
  if (name === 'grep_search') {
    const query = input.query || input.pattern || '';
    const targetDir = path.resolve(cwd, input.dir || '.');
    const { stdout } = await execFileAsync('grep', ['-rnI', query, targetDir], {
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
    }).catch((err) => ({ stdout: err.stdout || 'No matches found.' }));
    return stdout || 'No matches found.';
  }
  throw new Error(`Unknown tool: ${name}`);
}

/**
 * Main Agent Task Runner
 * Routes to Claude Agent SDK or OpenAI-compatible multi-provider loop
 */
export async function runAgentTask({
  prompt,
  cwd,
  onEvent,
  abortController = new AbortController(),
  provider = 'claude',
  model,
}) {
  const normProvider = (provider || 'claude').toLowerCase();
  const providerMeta = PROVIDERS[normProvider] || PROVIDERS.claude;
  const activeModel = model || providerMeta.defaultModel;

  onEvent({
    type: 'start',
    prompt,
    cwd,
    provider: normProvider,
    providerName: providerMeta.name,
    model: activeModel,
  });

  if (normProvider === 'claude') {
    return runClaudeLoop({ prompt, cwd, onEvent, abortController, model: activeModel });
  }

  // Multi-Provider OpenAI-compatible runner (Antigravity, Codex/OpenAI, OpenCode, Freebuff)
  let endpoint = '';
  if (normProvider === 'antigravity') {
    endpoint = process.env.ANTIGRAVITY_BASE_URL || 'http://127.0.0.1:8787/antigravity';
  } else if (normProvider === 'codex' || normProvider === 'openai') {
    endpoint = process.env.OPENAI_BASE_URL || 'http://127.0.0.1:8787/openai/v1';
  } else if (normProvider === 'opencode') {
    endpoint = process.env.OPENCODE_BASE_URL || 'http://127.0.0.1:8787/opencode/v1';
  } else if (normProvider === 'freebuff') {
    endpoint = process.env.FREEBUFF_BASE_URL || 'http://127.0.0.1:8787/freebuff/v1';
  } else {
    endpoint = process.env.OPENAI_BASE_URL || 'http://127.0.0.1:8787/openai/v1';
  }

  return runOpenAICompatibleLoop({
    prompt,
    cwd,
    onEvent,
    abortController,
    provider: normProvider,
    providerMeta,
    model: activeModel,
    endpoint,
  });
}

/**
 * Claude Runner with Claude Agent SDK + Anthropic Client SDK fallback
 */
async function runClaudeLoop({ prompt, cwd, onEvent, abortController, model }) {
  try {
    const options = {
      cwd,
      abortController,
      permissionMode: 'acceptEdits',
      allowedTools: ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep'],
      env: {
        ...process.env,
        ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || 'http://127.0.0.1:8787/anthropic',
        ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN || 'managed-by-gateway',
        CLAUDE_AGENT_SDK_CLIENT_APP: 'claude-dev-studio/1.0',
      },
    };
    if (model) options.model = model;

    console.log(`[agent:claude] Starting Claude Agent SDK query in ${cwd}...`);
    const q = query({ prompt, options });

    for await (const message of q) {
      if (abortController.signal.aborted) {
        onEvent({ type: 'aborted', message: 'Task stopped by user' });
        return;
      }

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

    console.warn(`[agent:claude] Claude Agent SDK note: ${err.message}. Trying direct Anthropic SDK runner...`);
    onEvent({
      type: 'warning',
      message: `Claude Agent SDK note: ${err.message}. Running fallback Anthropic Client loop.`,
    });

    try {
      await runAnthropicClientLoop({ prompt, cwd, onEvent, abortController, model });
    } catch (fallbackErr) {
      console.error('[agent:claude] Fallback error:', fallbackErr);
      onEvent({ type: 'error', error: fallbackErr.message });
    }
  }
}

/**
 * Fallback runner using @anthropic-ai/sdk
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

  const client = new Anthropic({ baseURL, apiKey });

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

  const systemPrompt = `You are an expert AI software engineer operating in directory: ${cwd}.
Inspect files, make edits, and run commands to complete the task. Explain all changes clearly.`;

  const messages = [{ role: 'user', content: prompt }];
  let turns = 0;
  const maxTurns = 20;

  while (turns < maxTurns) {
    if (abortController.signal.aborted) {
      onEvent({ type: 'aborted', message: 'Task stopped by user' });
      return;
    }
    turns++;
    onEvent({ type: 'status', status: 'thinking', description: `Turn ${turns} (Claude)...` });

    const response = await client.messages.create(
      {
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools,
      },
      { signal: abortController.signal }
    );

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

    const toolResults = [];
    for (const tool of toolUseBlocks) {
      let output = '';
      let isError = false;
      try {
        output = await executeWorkspaceTool(tool.name, tool.input, cwd);
      } catch (err) {
        output = `Error executing ${tool.name}: ${err.message}`;
        isError = true;
      }

      onEvent({ type: 'tool_result', id: tool.id, content: output, isError });
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

/**
 * Universal OpenAI-compatible Tool-Calling Loop
 * Powers Antigravity (Google / Gemini), Codex / OpenAI, OpenCode, and Freebuff
 */
export async function runOpenAICompatibleLoop({
  prompt,
  cwd,
  onEvent,
  abortController,
  provider,
  providerMeta,
  model,
  endpoint,
}) {
  const systemPrompt = `You are an expert AI software engineer operating in project directory: ${cwd}.
Provider: ${providerMeta.name} (${model}).
Inspect the code, make precise edits, and run commands to complete the user's task.
Explain what you modified clearly once finished.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];

  let turns = 0;
  const maxTurns = 20;

  console.log(`[agent:${provider}] Starting OpenAI-compatible loop at ${endpoint} with model ${model}...`);

  while (turns < maxTurns) {
    if (abortController.signal.aborted) {
      onEvent({ type: 'aborted', message: 'Task stopped by user' });
      return;
    }
    turns++;
    onEvent({
      type: 'status',
      status: 'thinking',
      description: `Turn ${turns} (${providerMeta.icon} ${providerMeta.name} · ${model})...`,
    });

    const targetUrl = `${endpoint.replace(/\/+$/, '')}/chat/completions`;
    let response;

    try {
      response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer managed-by-gateway',
        },
        body: JSON.stringify({
          model,
          messages,
          tools: OPENAI_TOOLS,
          tool_choice: 'auto',
        }),
        signal: abortController.signal,
      });
    } catch (fetchErr) {
      if (abortController.signal.aborted) {
        onEvent({ type: 'aborted', message: 'Task stopped by user' });
        return;
      }
      throw new Error(`Failed to reach ${providerMeta.name} endpoint at ${targetUrl}: ${fetchErr.message}`);
    }

    if (!response.ok) {
      const errText = await response.text();
      let errMsg = errText;
      try {
        const json = JSON.parse(errText);
        errMsg = json.error?.message || json.message || errText;
      } catch {}
      throw new Error(`${providerMeta.name} API error (${response.status}): ${errMsg}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice || !choice.message) {
      throw new Error(`Invalid response structure from ${providerMeta.name}: ${JSON.stringify(data)}`);
    }

    const assistantMsg = choice.message;
    if (assistantMsg.content) {
      onEvent({ type: 'text', text: assistantMsg.content });
    }

    messages.push(assistantMsg);

    const toolCalls = assistantMsg.tool_calls || [];
    if (toolCalls.length === 0) {
      onEvent({ type: 'complete', result: assistantMsg.content || 'Task finished successfully' });
      return;
    }

    // Execute tool calls
    for (const call of toolCalls) {
      if (abortController.signal.aborted) {
        onEvent({ type: 'aborted', message: 'Task stopped by user' });
        return;
      }

      const toolName = call.function?.name;
      let toolInput = {};
      try {
        toolInput = JSON.parse(call.function?.arguments || '{}');
      } catch {
        toolInput = { raw: call.function?.arguments };
      }

      onEvent({
        type: 'tool_call',
        id: call.id,
        name: toolName,
        input: toolInput,
      });

      let output = '';
      let isError = false;
      try {
        output = await executeWorkspaceTool(toolName, toolInput, cwd);
      } catch (err) {
        output = `Error executing ${toolName}: ${err.message}`;
        isError = true;
      }

      onEvent({
        type: 'tool_result',
        id: call.id,
        content: output,
        isError,
      });

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: output,
      });
    }
  }

  onEvent({ type: 'complete', result: 'Reached maximum iteration limit' });
}

/**
 * Generate AI Commit Message using any chosen provider
 */
export async function generateAiCommitMessage({
  diff,
  provider = 'claude',
  model,
}) {
  const normProvider = (provider || 'claude').toLowerCase();
  const providerMeta = PROVIDERS[normProvider] || PROVIDERS.claude;
  const activeModel = model || providerMeta.defaultModel;

  const prompt = `Based on the following git diff, generate a concise, professional conventional commit message (e.g. "feat(auth): add login token check" or "fix(server): handle null pointer in routes"). Return ONLY the single commit message, nothing else:\n\n${diff.slice(0, 8000)}`;

  if (normProvider === 'claude') {
    const client = new Anthropic({
      baseURL: process.env.ANTHROPIC_BASE_URL || 'http://127.0.0.1:8787/anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY || 'managed-by-gateway',
    });

    const response = await client.messages.create({
      model: activeModel,
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0]?.text?.trim() || 'chore: update project files';
  }

  // Multi-Provider OpenAI-compatible commit message generation
  let endpoint = '';
  if (normProvider === 'antigravity') {
    endpoint = process.env.ANTIGRAVITY_BASE_URL || 'http://127.0.0.1:8787/antigravity';
  } else if (normProvider === 'codex' || normProvider === 'openai') {
    endpoint = process.env.OPENAI_BASE_URL || 'http://127.0.0.1:8787/openai/v1';
  } else if (normProvider === 'opencode') {
    endpoint = process.env.OPENCODE_BASE_URL || 'http://127.0.0.1:8787/opencode/v1';
  } else if (normProvider === 'freebuff') {
    endpoint = process.env.FREEBUFF_BASE_URL || 'http://127.0.0.1:8787/freebuff/v1';
  } else {
    endpoint = process.env.OPENAI_BASE_URL || 'http://127.0.0.1:8787/openai/v1';
  }

  const res = await fetch(`${endpoint.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer managed-by-gateway',
    },
    body: JSON.stringify({
      model: activeModel,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 150,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI commit generation error (${res.status}): ${text}`);
  }

  const data = await res.json();
  const commitMsg = data.choices?.[0]?.message?.content?.trim();
  return commitMsg || 'chore: update project files';
}
