# csharp-parsing Specification

## Purpose
TBD - created by archiving change add-csharp-support. Update Purpose after archive.
## Requirements
### Requirement: C# language registration
The system SHALL register `csharp` as a supported parser language in `LANGUAGE_TO_PARSER`, and map it to the WASM file `tree-sitter-c_sharp.wasm` in `WASM_FILE_MAP`.

#### Scenario: C# parser loads successfully
- **WHEN** a project contains `.cs` files
- **THEN** the system SHALL load the `tree-sitter-c_sharp.wasm` parser from CDN cache and initialize it without error

#### Scenario: C# parser is cached after first download
- **WHEN** the C# WASM is downloaded for the first time
- **THEN** it SHALL be cached at `~/.zread/parsers/tree-sitter-c_sharp.wasm` and reused on subsequent runs

### Requirement: C# import extraction
The system SHALL extract `using_directive` nodes as imports from C# source files.

#### Scenario: Using directive extraction
- **WHEN** a `.cs` file contains `using System;` and `using System.Collections.Generic;`
- **THEN** the system SHALL extract both using directives as import entries

### Requirement: C# namespace extraction
The system SHALL extract both `namespace_declaration` and `file_scoped_namespace_declaration` nodes as namespace declarations.

#### Scenario: Block-scoped namespace
- **WHEN** a `.cs` file contains `namespace MyApp.Services { ... }`
- **THEN** the system SHALL extract `MyApp.Services` as a namespace with name `Services`

#### Scenario: File-scoped namespace
- **WHEN** a `.cs` file contains `namespace MyApp.Services;`
- **THEN** the system SHALL extract the file-scoped namespace declaration

### Requirement: C# type declaration extraction
The system SHALL extract the following type declarations with their names: `class_declaration`, `struct_declaration`, `interface_declaration`, `enum_declaration`, `record_declaration`, `delegate_declaration`.

#### Scenario: Class declaration with name
- **WHEN** a `.cs` file contains `public class UserService { ... }`
- **THEN** the system SHALL extract a class symbol with name `UserService`

#### Scenario: Interface declaration
- **WHEN** a `.cs` file contains `public IRepository<T> { ... }`
- **THEN** the system SHALL extract an interface symbol

#### Scenario: Struct declaration
- **WHEN** a `.cs` file contains `public struct Point { ... }`
- **THEN** the system SHALL extract a struct symbol

#### Scenario: Record declaration
- **WHEN** a `.cs` file contains `public record Person(string Name, int Age);`
- **THEN** the system SHALL extract a record symbol with name `Person`

#### Scenario: Enum declaration
- **WHEN** a `.cs` file contains `public enum Status { Active, Inactive }`
- **THEN** the system SHALL extract an enum symbol with name `Status`

#### Scenario: Delegate declaration
- **WHEN** a `.cs` file contains `public delegate void NotifyHandler(string message);`
- **THEN** the system SHALL extract a delegate symbol with name `NotifyHandler`

### Requirement: C# member declaration extraction
The system SHALL extract the following member declarations with their names and signatures: `method_declaration`, `constructor_declaration`, `property_declaration`, `event_declaration`, `indexer_declaration`, `operator_declaration`.

#### Scenario: Method with signature
- **WHEN** a `.cs` file contains `public async Task<User> GetUserAsync(int id) { ... }`
- **THEN** the system SHALL extract a function symbol with name `GetUserAsync` and signature excluding the method body

#### Scenario: Constructor
- **WHEN** a `.cs` file contains `public UserService(IRepository repo) { _repo = repo; }`
- **THEN** the system SHALL extract a function symbol with name `UserService` and constructor signature

#### Scenario: Property declaration
- **WHEN** a `.cs` file contains `public string Name { get; set; }`
- **THEN** the system SHALL extract a property symbol with name `Name`

#### Scenario: Event declaration
- **WHEN** a `.cs` file contains `public event EventHandler<string> OnMessage;`
- **THEN** the system SHALL extract an event symbol with name `OnMessage`

#### Scenario: Indexer declaration
- **WHEN** a `.cs` file contains `public string this[int index] { get => _items[index]; }`
- **THEN** the system SHALL extract an indexer symbol

#### Scenario: Operator overload
- **WHEN** a `.cs` file contains `public static Vector operator +(Vector a, Vector b) { ... }`
- **THEN** the system SHALL extract an operator symbol

### Requirement: Signature extraction compatibility
The system SHALL use the existing `extractFunctionSignature` function for C# method and constructor signatures. C# tree-sitter nodes SHALL use `body` field for method bodies, compatible with the universal approach.

#### Scenario: Method body excluded from signature
- **WHEN** a C# method node has a `body` field (block node)
- **THEN** the system SHALL build the signature from all children except the body node

#### Scenario: Expression-bodied method
- **WHEN** a C# method uses arrow expression `=>` syntax (body is `arrow_expression_clause`)
- **THEN** the system SHALL exclude the arrow expression from the signature

