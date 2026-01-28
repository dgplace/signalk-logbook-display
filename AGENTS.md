# AGENTS Instructions

These directives guide AI assistants working on this codebase.

## Code Style

* Follow PEP 8 style guidelines (4-space indentation, descriptive names) for Python code.
* After editing Python files, run `python -m py_compile <file>` for each modified module to ensure there are no syntax errors.
* Use TypeScript-style JSDoc typedefs for shared structures in JavaScript code.
* Prefer small functions or methods with single purpose.
* All methods or functions should have a standard document header describing the function and parameters.
* Change only code that is necessary for the requested task.

## Documentation

**CRITICAL: For EVERY change to the codebase, you MUST update ALL relevant documentation files:**
- **LOG.md** - ALWAYS update with dated entries for every change
- **ARCHITECTURE.md** - Update when architecture, data flow, or file responsibilities change
- **README.md** - Update when user-facing features or behavior changes

**This is mandatory, not optional. No code change is complete without documentation updates.**

* Consult [ARCHITECTURE.md](ARCHITECTURE.md) for system architecture, data flow, and file responsibilities.
* Update [LOG.md](LOG.md) with dated change entries (YYYY-MM-DD format) summarizing what was changed.
  - LOG entries must include the date at the start of each section.
  - Group related changes under the same date heading.
  - Keep entries concise and focused on what changed, not why.
* Update [ARCHITECTURE.md](ARCHITECTURE.md) if architectural decisions or design patterns change.
* Update [README.md](README.md) for user-facing documentation (features, usage, setup).

## Commits

* do not commits changes unless asked to
* Use clear, concise commit messages summarizing the changes.
* Always propose a commit message before committing.

## File Organization

* **AGENTS.md** (this file): Directives for AI assistants
* **LOG.md**: Chronological change log with dates
* **ARCHITECTURE.md**: System architecture and technical design
* **README.md**: User-facing documentation and usage guide