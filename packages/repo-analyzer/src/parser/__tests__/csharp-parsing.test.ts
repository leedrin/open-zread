import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import Parser from 'web-tree-sitter';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';

let csharpParser: Parser;

const CSHARP_WASM = 'tree-sitter-c_sharp.wasm';

function getTreeSitterDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  let current = dirname(__filename);
  for (let i = 0; i < 10; i++) {
    const bunCandidate = join(current, 'node_modules', '.bun', 'web-tree-sitter@0.20.8', 'node_modules', 'web-tree-sitter');
    if (existsSync(join(bunCandidate, 'tree-sitter.wasm'))) return bunCandidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return '';
}

async function downloadWasmIfNeeded(): Promise<Uint8Array> {
  const cacheDir = join(homedir(), '.zread', 'parsers');
  const wasmPath = join(cacheDir, CSHARP_WASM);

  if (existsSync(wasmPath)) {
    return new Uint8Array(readFileSync(wasmPath));
  }

  const url = `https://cdn.jsdelivr.net/npm/tree-sitter-wasms@0.1.13/out/${CSHARP_WASM}`;
  console.log(`Downloading C# WASM: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download C# WASM: ${response.status}`);
  }

  const buffer = new Uint8Array(await response.arrayBuffer());

  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }
  writeFileSync(wasmPath, Buffer.from(buffer));

  return buffer;
}

async function initCSharpParser(): Promise<void> {
  const treeSitterDir = getTreeSitterDir();

  await Parser.init({
    locateFile: (fileName: string) => join(treeSitterDir, fileName)
  });

  const wasmBuffer = await downloadWasmIfNeeded();
  const lang = await Parser.Language.load(wasmBuffer);

  csharpParser = new Parser();
  csharpParser.setLanguage(lang);
}

const CSHARP_QUERY = `
  (using_directive) @import
  (namespace_declaration name: (identifier) @ns_name) @namespace
  (file_scoped_namespace_declaration name: (identifier) @ns_name) @namespace
  (class_declaration name: (identifier) @class_name) @class
  (struct_declaration name: (identifier) @struct_name) @struct
  (interface_declaration name: (identifier) @iface_name) @iface
  (enum_declaration name: (identifier) @enum_name) @enum
  (record_declaration name: (identifier) @record_name) @record
  (delegate_declaration name: (identifier) @delegate_name) @delegate
  (method_declaration name: (identifier) @method_name) @method
  (constructor_declaration name: (identifier) @ctor_name) @ctor
  (property_declaration name: (identifier) @prop_name) @prop
  (event_declaration name: (identifier) @event_name) @event
  (indexer_declaration) @indexer
  (operator_declaration) @operator
`;

function extractFunctionSignature(node: Parser.SyntaxNode): string {
  const bodyNode = node.childForFieldName('body');
  if (bodyNode) {
    const bodyId = bodyNode.id;
    const parts: string[] = [];
    for (const child of node.children) {
      if (child.id === bodyId) continue;
      parts.push(child.text);
    }
    return parts.join(' ').trim();
  }
  return node.text.split('\n')[0].trim();
}

interface ExtractionResult {
  imports: string[];
  exports: string[];
  functions: Array<{ name: string; signature: string }>;
}

function extractAll(source: string): ExtractionResult {
  const tree = csharpParser.parse(source);
  const lang = csharpParser.getLanguage();
  const query = lang.query(CSHARP_QUERY);
  const matches = query.matches(tree.rootNode);

  const imports: string[] = [];
  const exports: string[] = [];
  const functions: Array<{ name: string; signature: string }> = [];

  for (const match of matches) {
    for (const capture of match.captures) {
      const node = capture.node;
      const name = capture.name;

      if (name === 'import') {
        imports.push(node.text);
      } else if (name === 'method' || name === 'ctor' || name === 'prop' || name === 'event' || name === 'indexer' || name === 'operator') {
        const fnNameNode = node.childForFieldName('name');
        const fnName = fnNameNode?.text || 'anonymous';
        functions.push({
          name: fnName,
          signature: extractFunctionSignature(node),
        });
      } else if (name === 'class' || name === 'struct' || name === 'iface' || name === 'enum' || name === 'record' || name === 'delegate' || name === 'namespace') {
        const declNameNode = node.childForFieldName('name');
        const declName = declNameNode?.text || node.type;
        exports.push(`${node.type.replace('_declaration', '')} ${declName}`);
      }
    }
  }

  tree.delete();
  return { imports, exports, functions };
}

describe('C# Parser - Symbol Extraction', () => {
  beforeAll(async () => {
    await initCSharpParser();
  });

  afterAll(() => {
    csharpParser?.delete();
  });

  describe('Using Directive Extraction', () => {
    test('should extract using directives as imports', () => {
      const code = `
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace MyApp {
  public class Service { }
}`;
      const result = extractAll(code);

      expect(result.imports.length).toBe(3);
      expect(result.imports[0]).toBe('using System;');
      expect(result.imports[1]).toBe('using System.Collections.Generic;');
      expect(result.imports[2]).toBe('using System.Threading.Tasks;');
    });
  });

  describe('Namespace Extraction', () => {
    test('should extract block-scoped namespace', () => {
      const code = `
namespace MyApp.Services {
  public class UserService { }
}`;
      const result = extractAll(code);

      expect(result.exports).toContain('namespace MyApp');
    });

    test('should extract file-scoped namespace', () => {
      const code = `namespace MyApp.Services;

public class UserService { }`;
      const result = extractAll(code);

      expect(result.exports.some(e => e.includes('namespace'))).toBe(true);
    });
  });

  describe('Type Declaration Extraction', () => {
    test('should extract class declaration', () => {
      const code = `
public class UserService {
  public void DoWork() { }
}`;
      const result = extractAll(code);

      expect(result.exports).toContain('class UserService');
    });

    test('should extract generic class', () => {
      const code = `
public class Repository<T> where T : class {
  public T FindById(int id) => default;
}`;
      const result = extractAll(code);

      expect(result.exports.some(e => e.includes('class') && e.includes('Repository'))).toBe(true);
    });

    test('should extract struct declaration', () => {
      const code = `
public struct Point {
  public double X { get; set; }
  public double Y { get; set; }
}`;
      const result = extractAll(code);

      expect(result.exports).toContain('struct Point');
    });

    test('should extract interface declaration', () => {
      const code = `
public interface IRepository<T> {
  T FindById(int id);
  void Save(T entity);
}`;
      const result = extractAll(code);

      expect(result.exports.some(e => e.includes('interface') && e.includes('IRepository'))).toBe(true);
    });

    test('should extract enum declaration', () => {
      const code = `
public enum Status {
  Active,
  Inactive,
  Pending
}`;
      const result = extractAll(code);

      expect(result.exports).toContain('enum Status');
    });

    test('should extract record declaration', () => {
      const code = `public record Person(string Name, int Age);`;
      const result = extractAll(code);

      expect(result.exports).toContain('record Person');
    });

    test('should extract delegate declaration', () => {
      const code = `public delegate void NotifyHandler(string message, int priority);`;
      const result = extractAll(code);

      expect(result.exports).toContain('delegate NotifyHandler');
    });
  });

  describe('Member Declaration Extraction', () => {
    test('should extract method with signature', () => {
      const code = `
public class Service {
  public async Task<User> GetUserAsync(int id) {
    return await _repository.FindByIdAsync(id);
  }
}`;
      const result = extractAll(code);

      const method = result.functions.find(f => f.name === 'GetUserAsync');
      expect(method).toBeDefined();
      expect(method?.signature).toContain('GetUserAsync');
      expect(method?.signature).toContain('int id');
      expect(method?.signature).not.toContain('await _repository');
    });

    test('should extract constructor', () => {
      const code = `
public class UserService {
  private readonly IRepository _repo;
  public UserService(IRepository repo) {
    _repo = repo;
  }
}`;
      const result = extractAll(code);

      const ctor = result.functions.find(f => f.name === 'UserService');
      expect(ctor).toBeDefined();
      expect(ctor?.signature).toContain('IRepository repo');
      expect(ctor?.signature).not.toContain('_repo = repo');
    });

    test('should extract property declaration', () => {
      const code = `
public class User {
  public string Name { get; set; }
  public int Age { get; init; }
}`;
      const result = extractAll(code);

      expect(result.functions.some(f => f.name === 'Name')).toBe(true);
      expect(result.functions.some(f => f.name === 'Age')).toBe(true);
    });

    test('should extract event declaration', () => {
      const code = `
public class Publisher {
  public event EventHandler<string> OnMessage;
}`;
      const result = extractAll(code);

      expect(result.functions.some(f => f.name === 'OnMessage')).toBe(true);
    });

    test('should extract indexer declaration', () => {
      const code = `
public class MyList {
  private string[] _items = new string[10];
  public string this[int index] {
    get => _items[index];
    set => _items[index] = value;
  }
}`;
      const result = extractAll(code);

      expect(result.functions.some(f => f.signature.includes('this'))).toBe(true);
    });

    test('should extract operator overload', () => {
      const code = `
public class Vector {
  public double X { get; set; }
  public double Y { get; set; }
  public static Vector operator +(Vector a, Vector b) {
    return new Vector { X = a.X + b.X, Y = a.Y + b.Y };
  }
}`;
      const result = extractAll(code);

      expect(result.functions.some(f => f.signature.includes('operator'))).toBe(true);
    });
  });

  describe('Expression-bodied Members', () => {
    test('should extract expression-bodied method signature', () => {
      const code = `
public class Calculator {
  public int Add(int a, int b) => a + b;
}`;
      const result = extractAll(code);

      const method = result.functions.find(f => f.name === 'Add');
      expect(method).toBeDefined();
      expect(method?.signature).toContain('Add');
      expect(method?.signature).not.toContain('a + b');
    });
  });

  describe('Comprehensive C# File', () => {
    test('should extract all symbols from a realistic C# file', () => {
      const code = `
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace MyApp.Services
{
    public enum UserRole
    {
        Admin,
        User,
        Guest
    }

    public interface IUserService
    {
        Task<User> GetUserAsync(int id);
        void Save(User user);
    }

    public delegate void UserChangedHandler(User user);

    public record UserNotification(string Message, DateTime Timestamp);

    public class UserService : IUserService
    {
        private readonly IRepository<User> _repo;
        public event EventHandler<User> OnUserChanged;

        public UserService(IRepository<User> repo)
        {
            _repo = repo;
        }

        public async Task<User> GetUserAsync(int id)
        {
            return await _repo.FindByIdAsync(id);
        }

        public void Save(User user)
        {
            _repo.Save(user);
        }

        public string this[int id] => _repo.FindByIdAsync(id).Result?.Name ?? "Unknown";
    }

    public struct UserStats
    {
        public int TotalUsers { get; set; }
        public int ActiveUsers { get; set; }
    }
}`;
      const result = extractAll(code);

      expect(result.imports.length).toBe(3);

      expect(result.exports.some(e => e.includes('namespace'))).toBe(true);
      expect(result.exports.some(e => e.includes('enum') && e.includes('UserRole'))).toBe(true);
      expect(result.exports.some(e => e.includes('interface') && e.includes('IUserService'))).toBe(true);
      expect(result.exports.some(e => e.includes('delegate') && e.includes('UserChangedHandler'))).toBe(true);
      expect(result.exports.some(e => e.includes('record') && e.includes('UserNotification'))).toBe(true);
      expect(result.exports.some(e => e.includes('class') && e.includes('UserService'))).toBe(true);
      expect(result.exports.some(e => e.includes('struct') && e.includes('UserStats'))).toBe(true);

      expect(result.functions.some(f => f.name === 'GetUserAsync')).toBe(true);
      expect(result.functions.some(f => f.name === 'Save')).toBe(true);
      expect(result.functions.some(f => f.name === 'UserService')).toBe(true);
      expect(result.functions.some(f => f.name === 'OnUserChanged')).toBe(true);
      expect(result.functions.some(f => f.name === 'TotalUsers')).toBe(true);
    });
  });
});
