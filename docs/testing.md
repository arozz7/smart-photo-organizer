# Testing Guide

This guide documents the testing infrastructure for Smart Photo Organizer.

## Quick Start

```powershell
# Run all tests
npm run test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch

# Run only backend tests
npm run test:backend

# Run only frontend tests  
npm run test:frontend

# Generate coverage report
npm run test:coverage
```

## Test Structure

```
tests/
├── backend/                      # Electron/Node.js tests
│   ├── unit/
│   │   ├── repositories/         # Database repository tests
│   │   │   ├── FaceRepository.test.ts
│   │   │   ├── PersonRepository.test.ts
│   │   │   └── PhotoRepository.test.ts
│   │   └── services/             # Business logic tests (planned)
│   ├── integration/              # Integration tests (planned)
│   └── mocks/
│       ├── mockDatabase.ts       # In-memory SQLite factory
│       └── mockFileSystem.ts     # Virtual file system
│
├── frontend/                     # React tests
│   ├── unit/
│   │   ├── contexts/             # Context provider tests (planned)
│   │   ├── hooks/                # Custom hook tests (planned)
│   │   └── components/           # Component tests (planned)
│   ├── mocks/
│   └── setup.tsx                 # Frontend setup with Electron API mock
│
├── python/                       # Python backend tests (planned)
│   ├── unit/
│   └── integration/
│
└── setup.ts                      # Global test setup
```

## Writing Tests

### Test Pattern (AAA)

All tests follow the Arrange-Act-Assert pattern:

```typescript
it('should return faces matching the given ids', () => {
    // Arrange - Set up test data and conditions
    const photoId = seedPhoto(db);
    const faceId = seedFace(db, photoId);
    
    // Act - Execute the code under test
    const result = FaceRepository.getFacesByIds([faceId]);
    
    // Assert - Verify the expected outcome
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(faceId);
});
```

### Using the Mock Database

For backend tests that need database access:

```typescript
import { 
  createTestDatabase, 
  closeTestDatabase, 
  seedPhoto, 
  seedFace 
} from '../../mocks/mockDatabase';

// Mock the getDB function before importing your module
vi.mock('../../../../electron/db', () => ({
    getDB: vi.fn()
}));

import { YourRepository } from '../../../../electron/...';
import { getDB } from '../../../../electron/db';

describe('YourRepository', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDatabase();
    vi.mocked(getDB).mockReturnValue(db);
  });

  afterEach(() => {
    closeTestDatabase();
    vi.clearAllMocks();
  });

  // Your tests here...
});
```

### Available Seed Helpers

| Helper | Description |
|--------|-------------|
| `seedPhoto(db, overrides?)` | Creates a photo record |
| `seedPerson(db, name)` | Creates a person record |
| `seedFace(db, photoId, overrides?)` | Creates a face record |
| `createTestDescriptor(seed)` | Generates 512-float face embedding |

### Adding Additional Tables

If your test needs tables not in the base schema, add them in `beforeEach`:

```typescript
beforeEach(() => {
  db = createTestDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS your_table (
      id INTEGER PRIMARY KEY,
      ...
    );
  `);
  vi.mocked(getDB).mockReturnValue(db);
});
```

## Testing Guidelines

Based on `.agent/rules/testing-master.md`:

### ✅ DO

- **Test Behavior, Not Implementation**: Assert on outputs, not internal method calls
- **Use Real Dependencies**: Use in-memory SQLite instead of mocking the database driver
- **Mock External Systems**: Mock file system, network, and third-party APIs
- **Test Edge Cases**: Include null, empty, boundary, and error scenarios
- **Keep Tests Atomic**: Each test should be independent with its own setup/teardown

### ❌ DON'T

- Don't test private methods or internal state
- Don't rely on test execution order
- Don't use `sleep()` or time-based waits
- Don't mock internal class methods
- Don't write tests that just check if a constant equals itself

## Coverage Goals

| Layer | Target |
|-------|--------|
| Repositories | >80% branch coverage |
| Services | >70% branch coverage |
| React Contexts | >60% branch coverage |
| Hooks | >70% branch coverage |

## Behavior Change Protocol

When modifying existing functionality:

1. Run existing tests to ensure they pass
2. Update tests to reflect new intended behavior
3. Mark the change in commit message: `[BEHAVIOR CHANGE]`
4. Document the change in `aiChangeLog/phase-XX.md`

Example:
```markdown
## Behavior Changes
- `FaceService.findPotentialMatches()`: Now excludes ignored faces
- Test updated: `FaceService.test.ts` line 45
```
