import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

export interface SecretLeak {
  filePath: string;
  line: number;
  matchedText: string; // 前 4 字符 + '***'
  severity: 'error';
}

const SECRET_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /(?:sk-|pk-|ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9]{10,}/g,
    label: 'API Key / Token',
  },
  {
    pattern: /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
    label: 'Config Secret',
  },
  {
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/gi,
    label: 'Password',
  },
];

function maskText(text: string): string {
  if (text.length <= 4) return '****';
  return text.slice(0, 4) + '***';
}

/**
 * 判断某行是否在 ```mermaid 代码块内部
 */
function isInsideMermaidBlock(lines: string[], lineIndex: number): boolean {
  let inMermaid = false;
  for (let i = 0; i <= lineIndex; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('```mermaid')) {
      inMermaid = true;
    } else if (trimmed === '```' && inMermaid) {
      inMermaid = false;
    }
  }
  // 如果在 mermaid 块内且不是 fence 行本身，视为内部
  return (
    inMermaid &&
    lines[lineIndex]?.trim() !== '```mermaid' &&
    lines[lineIndex]?.trim() !== '```'
  );
}

/**
 * 扫描单个 markdown 字符串，返回发现的所有密钥泄漏
 */
export function scanSecrets(filePath: string, content: string): SecretLeak[] {
  const leaks: SecretLeak[] = [];
  const lines = content.split('\n');

  for (const { pattern } of SECRET_PATTERNS) {
    // 重新创建正则以重置 lastIndex
    const flags = pattern.flags.replace('g', '') + 'g';
    const re = new RegExp(pattern.source, flags);

    for (let i = 0; i < lines.length; i++) {
      // 跳过 Mermaid 代码块内部
      if (isInsideMermaidBlock(lines, i)) continue;

      re.lastIndex = 0;
      const line = lines[i];
      let match: RegExpExecArray | null;
      while ((match = re.exec(line)) !== null) {
        const matched = match[0];

        // 跳过已脱敏的占位符
        if (/^<[^>]+>$/.test(matched)) continue;
        if (matched.startsWith('***')) continue;
        if (/^[X*]{3,}$/.test(matched)) continue;
        // 跳过 X 开头的占位符如 XXXXXXXX
        if (/^X{4,}$/i.test(matched)) continue;

        leaks.push({
          filePath,
          line: i + 1,
          matchedText: maskText(matched),
          severity: 'error',
        });
      }
    }
  }

  return leaks;
}

/**
 * 递归收集目录下所有 .md 文件
 */
function collectMdFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        files.push(...collectMdFiles(full));
      } else if (entry.isFile() && extname(entry.name) === '.md') {
        files.push(full);
      }
    }
  } catch {
    // skip unreadable dirs
  }
  return files;
}

/**
 * 扫描 wiki/ 目录下所有 .md 文件中的密钥泄漏
 */
export function scanWikiForSecrets(wikiPath: string): SecretLeak[] {
  if (!existsSync(wikiPath)) return [];

  const mdFiles = collectMdFiles(wikiPath);
  const allLeaks: SecretLeak[] = [];

  for (const filePath of mdFiles) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const leaks = scanSecrets(filePath, content);
      allLeaks.push(...leaks);
    } catch {
      // skip unreadable files
    }
  }

  return allLeaks;
}
