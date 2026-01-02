# Testing Guide

**Last updated:** December 31, 2025  
**Status:** Testing infrastructure fully implemented ✅

---

## Overview

This project now includes comprehensive unit testing for both the frontend (Vue/TypeScript) and backend (Rust) components. Testing helps ensure code quality, catch regressions early, and make refactoring safer.

### Test Coverage

```
Frontend Tests:  27 tests (settings store, components, types)
Rust Tests:      5 tests (mathematical functions)
Total:           32 tests
Status:          All passing ✅
```

---

## Frontend Testing

### Technology Stack

- **Vitest** - Fast unit test framework for Vite projects
- **@vue/test-utils** - Official Vue 3 testing utilities
- **happy-dom** - Lightweight DOM implementation for tests

### Running Frontend Tests

```bash
cd frontend

# Run tests once
npm test

# Run tests in watch mode (auto-rerun on changes)
npm run test

# Run tests with UI (visual test runner)
npm run test:ui

# Run tests once (CI mode)
npm run test:run

# Run with coverage report
npm run test:coverage
```

### Test Structure

```
frontend/src/
├── stores/
│   └── __tests__/
│       └── settings.test.ts        # Settings store tests (20 tests)
├── components/
│   └── __tests__/
│       └── LanguageSelector.test.ts # Component tests (4 tests)
└── __tests__/
    └── types.test.ts               # Type definition tests (3 tests)
```

### Writing Frontend Tests

#### Testing a Store

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSettingsStore } from '../settings';

describe('Settings Store', () => {
  beforeEach(() => {
    // Create fresh pinia for each test
    setActivePinia(createPinia());
  });

  it('should toggle dark mode', () => {
    const store = useSettingsStore();
    
    store.setThemeMode('dark');
    expect(store.isDarkMode).toBe(true);
    
    store.setThemeMode('light');
    expect(store.isDarkMode).toBe(false);
  });
});
```

#### Testing a Vue Component

```typescript
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import MyComponent from '../MyComponent.vue';

describe('MyComponent', () => {
  it('should render correctly', () => {
    const wrapper = mount(MyComponent, {
      props: {
        title: 'Test Title'
      }
    });
    
    expect(wrapper.text()).toContain('Test Title');
    expect(wrapper.find('.my-class').exists()).toBe(true);
  });

  it('should emit event on click', async () => {
    const wrapper = mount(MyComponent);
    
    await wrapper.find('button').trigger('click');
    
    expect(wrapper.emitted('click')).toBeTruthy();
    expect(wrapper.emitted('click')).toHaveLength(1);
  });
});
```

#### Testing with i18n

```typescript
import { createI18n } from 'vue-i18n';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: { greeting: 'Hello' },
    de: { greeting: 'Hallo' }
  }
});

const wrapper = mount(MyComponent, {
  global: {
    plugins: [i18n]
  }
});
```

### Current Test Files

#### `settings.test.ts` (20 tests)

Tests for the Pinia settings store:

**Theme Mode (6 tests)**
- ✅ Initialize with auto theme
- ✅ Cycle through theme modes (auto → light → dark → auto)
- ✅ Set theme mode directly
- ✅ Compute isDarkMode based on system preference
- ✅ Compute isDarkMode when theme is dark
- ✅ Compute isDarkMode when theme is light

**Normalized View (3 tests)**
- ✅ Initialize with normalized view off
- ✅ Toggle normalized view
- ✅ Set normalized view directly

**Filters (2 tests)**
- ✅ Initialize with default filter values
- ✅ Allow updating filter values

**Clustering Variant (2 tests)**
- ✅ Initialize with locked variant
- ✅ Not allow changing variant (locked)

**RAG Auth Token (3 tests)**
- ✅ Initialize with empty token
- ✅ Set auth token
- ✅ Clear auth token

**Speaker Selection (4 tests)**
- ✅ Initialize with no selected speaker
- ✅ Set selected speaker
- ✅ Set second speaker
- ✅ Clear selected speaker

#### `LanguageSelector.test.ts` (4 tests)

Tests for the language selector component:

- ✅ Render language selector button
- ✅ Display current locale
- ✅ Show dropdown when button is clicked
- ✅ Change locale when option is clicked

#### `types.test.ts` (3 tests)

Tests for TypeScript type definitions:

- ✅ Accept valid TopicRiverData
- ✅ Accept valid SpeakerRiverData
- ✅ Accept valid HeatmapData

---

## Rust Testing

### Running Rust Tests

```bash
# Run all tests
cargo test

# Run only library tests
cargo test --lib

# Run tests for specific binary
cargo test --bin cluster-topics
cargo test --bin cluster-topics-v2
cargo test --bin rag-backend

# Run tests with output
cargo test -- --nocapture

# Run specific test
cargo test test_cosine_distance_identical_vectors

# Run tests in release mode (faster, but slower to compile)
cargo test --release
```

### Test Structure

```
src/
├── lib.rs                    # Library tests (5 tests)
├── cluster_topics.rs         # V1 clustering (no tests yet)
├── cluster_topics_v2.rs      # V2 clustering (no tests yet)
└── rag_backend.rs            # RAG backend (no tests yet)
```

### Writing Rust Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_example() {
        let result = my_function(42);
        assert_eq!(result, 42);
    }

    #[test]
    fn test_with_error_handling() {
        let result = fallible_function();
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), expected_value);
    }

    #[test]
    #[should_panic(expected = "error message")]
    fn test_panic() {
        panic_function();
    }
}
```

### Current Test Files

#### `lib.rs` (5 tests)

Tests for mathematical utility functions:

- ✅ `test_cosine_distance_identical_vectors` - Distance between identical vectors is 0
- ✅ `test_cosine_distance_orthogonal_vectors` - Distance between orthogonal vectors is 1
- ✅ `test_weighted_average` - Weighted average calculation
- ✅ `test_vector_normalization` - Normalization produces unit vector
- ✅ `test_vector_operations` - Basic vector operations (addition, dot product)

---

## Continuous Integration

### GitHub Actions Setup (Recommended)

Create `.github/workflows/test.yml`:

```yaml
name: Tests

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  frontend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json
      
      - name: Install dependencies
        run: cd frontend && npm ci
      
      - name: Run tests
        run: cd frontend && npm run test:run
      
      - name: Generate coverage
        run: cd frontend && npm run test:coverage
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./frontend/coverage/coverage-final.json
          flags: frontend

  rust-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Rust
        uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
          override: true
      
      - name: Cache cargo
        uses: actions/cache@v3
        with:
          path: |
            ~/.cargo/bin/
            ~/.cargo/registry/index/
            ~/.cargo/registry/cache/
            ~/.cargo/git/db/
            target/
          key: ${{ runner.os }}-cargo-${{ hashFiles('**/Cargo.lock') }}
      
      - name: Run tests
        run: cargo test --verbose
```

### GitLab CI Setup

Create `.gitlab-ci.yml`:

```yaml
stages:
  - test

frontend-test:
  stage: test
  image: node:20
  before_script:
    - cd frontend
    - npm ci
  script:
    - npm run test:run
  cache:
    paths:
      - frontend/node_modules/

rust-test:
  stage: test
  image: rust:latest
  before_script:
    - cargo --version
  script:
    - cargo test --verbose
  cache:
    paths:
      - target/
```

---

## Test Coverage

### Current Coverage

```
Frontend:
├── Stores:        High (settings store fully tested)
├── Components:    Low (only LanguageSelector tested)
├── Views:         None
├── Composables:   None
└── Utils:         None

Rust:
├── Library:       Low (basic math functions only)
├── Clustering:    None
└── RAG Backend:   None
```

### Coverage Goals

**Phase 1 (Complete)** ✅
- ✅ Set up testing framework
- ✅ Test settings store
- ✅ Test one Vue component
- ✅ Test TypeScript types
- ✅ Test Rust utility functions

**Phase 2 (Recommended Next Steps)**
- Add tests for critical Vue components (TopicRiver, SpeakerRiver)
- Add tests for composables (useVariants)
- Add tests for clustering algorithm functions
- Add integration tests for RAG backend API

**Phase 3 (Future)**
- E2E tests with Playwright or Cypress
- Visual regression tests
- Performance benchmarks
- Increase coverage to 70%+

---

## Best Practices

### General

1. **Write tests first** (TDD) or immediately after implementation
2. **Test behavior, not implementation** - Focus on what, not how
3. **One assertion per test** - Makes failures easier to diagnose
4. **Use descriptive test names** - `should_return_error_when_input_invalid`
5. **Arrange-Act-Assert** - Clear test structure

### Frontend

1. **Mock external dependencies** - APIs, localStorage, etc.
2. **Test user interactions** - Clicks, inputs, form submissions
3. **Test edge cases** - Empty states, loading states, errors
4. **Avoid testing library code** - Don't test Vue, Pinia, or D3
5. **Use test IDs** - `data-testid="submit-button"` for stable selectors

### Rust

1. **Test public API** - Focus on exported functions
2. **Test error paths** - Use `#[should_panic]` or Result assertions
3. **Use test fixtures** - Create helper functions for test data
4. **Test concurrency** - Use `cargo test -- --test-threads=1` if needed
5. **Benchmark critical code** - Use `cargo bench` for performance tests

---

## Troubleshooting

### Frontend Tests

**Issue: Tests fail with "Cannot find module"**
```bash
# Solution: Check vitest.config.ts alias configuration
resolve: {
  alias: {
    '@': fileURLToPath(new URL('./src', import.meta.url))
  }
}
```

**Issue: Component tests fail with "Cannot read property"**
```bash
# Solution: Mock global objects in test setup
global.window = { ... };
global.localStorage = { ... };
```

**Issue: i18n tests fail**
```bash
# Solution: Always provide i18n plugin to mount
mount(Component, {
  global: { plugins: [i18n] }
});
```

### Rust Tests

**Issue: Tests pass individually but fail when run together**
```bash
# Solution: Run tests serially
cargo test -- --test-threads=1
```

**Issue: Tests can't find test data files**
```bash
# Solution: Use relative paths from project root
let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .join("test-data/example.json");
```

**Issue: Async tests timeout**
```bash
# Solution: Use tokio test runtime
#[tokio::test]
async fn test_async_function() {
    // test code
}
```

---

## Adding New Tests

### Frontend: Adding a New Component Test

1. Create test file: `src/components/__tests__/MyComponent.test.ts`
2. Write tests:

```typescript
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import MyComponent from '../MyComponent.vue';

describe('MyComponent', () => {
  it('should render', () => {
    const wrapper = mount(MyComponent);
    expect(wrapper.exists()).toBe(true);
  });
});
```

3. Run tests: `npm test`

### Rust: Adding a New Test

1. Add test module to your file:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_my_function() {
        assert_eq!(my_function(), expected_value);
    }
}
```

2. Run tests: `cargo test`

---

## Test Data

### Fixtures

Create test fixture files for complex test data:

**Frontend:**
```typescript
// src/__tests__/fixtures/topic-data.ts
export const mockTopicData: TopicRiverData = {
  generatedAt: '2024-01-01T00:00:00Z',
  description: 'Test data',
  statistics: { /* ... */ },
  topics: { /* ... */ }
};
```

**Rust:**
```rust
// tests/fixtures/mod.rs
pub fn sample_embedding() -> Vec<f64> {
    vec![0.1, 0.2, 0.3, 0.4]
}
```

---

## Performance Testing

### Frontend

Use Vitest benchmarks:

```typescript
import { bench } from 'vitest';

bench('heavy computation', () => {
  expensiveFunction();
});
```

### Rust

Use criterion for benchmarks:

```bash
# Add to Cargo.toml
[dev-dependencies]
criterion = "0.5"

[[bench]]
name = "clustering"
harness = false
```

```rust
// benches/clustering.rs
use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn benchmark_clustering(c: &mut Criterion) {
    c.bench_function("cluster 1000 items", |b| {
        b.iter(|| {
            cluster_items(black_box(1000))
        });
    });
}

criterion_group!(benches, benchmark_clustering);
criterion_main!(benches);
```

---

## Resources

### Frontend Testing
- [Vitest Documentation](https://vitest.dev/)
- [Vue Test Utils](https://test-utils.vuejs.org/)
- [Testing Library Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)

### Rust Testing
- [The Rust Book - Testing](https://doc.rust-lang.org/book/ch11-00-testing.html)
- [Rust By Example - Testing](https://doc.rust-lang.org/rust-by-example/testing.html)
- [Criterion Benchmarking](https://github.com/bheisler/criterion.rs)

---

## Summary

✅ **Testing framework set up** for both frontend and Rust  
✅ **32 tests written and passing**  
✅ **CI-ready** configuration examples provided  
✅ **Documentation complete** with examples and best practices  

### Next Steps

1. **Add more component tests** - Cover critical UI components
2. **Add clustering algorithm tests** - Test V1 and V2 implementations
3. **Add integration tests** - Test RAG backend API endpoints
4. **Set up CI/CD** - Automate test runs on push/PR
5. **Increase coverage** - Aim for 70%+ coverage on critical paths

**Testing is now part of the development workflow!** 🎉




