# Contributing to QuackWrangler

Thank you for your interest in contributing to QuackWrangler! This guide will help you get started.

## Prerequisites

- Node.js 18 or higher
- npm 9 or higher
- VS Code 1.85.0 or higher
- Python 3.10 or higher when changing the optional Polars sidecar
- [uv](https://docs.astral.sh/uv/) recommended for Python dependency management
- Git

## Development Setup

1. **Fork and clone the repository**

```bash
git clone https://github.com/mohsinsurani/quackwrangler.git
cd quackwrangler
```

2. **Install dependencies**

```bash
npm ci
npm --prefix webview-ui ci
```

3. **Open in VS Code**

```bash
code .
```

4. **Build the extension**

```bash
npm run build
```

5. **Run the extension**

Press `F5` in VS Code to launch the Extension Development Host.

Python is not required for Version 1. When changing the optional Version 2
sidecar, install its recorded environment with:

```bash
uv sync --frozen --extra arrow --extra dev
```

## Development Workflow

### Making Changes

1. Create a feature branch:
   ```bash
   git checkout -b feature/my-feature
   ```

2. Make your changes in the `src/` directory

3. Build and test:
   ```bash
    npm run build
    npm test
    uv run ruff check src/sidecar
    uv run ruff format --check src/sidecar
   ```

4. Commit your changes:
   ```bash
   git commit -m "feat: add my feature"
   ```

5. Push and create a PR:
   ```bash
   git push origin feature/my-feature
   ```

### Code Style

- Use TypeScript with strict mode
- Follow Prettier formatting (single quotes, trailing commas)
- Use ESLint for code quality
- Write meaningful commit messages
- Record Python runtime and optional dependencies in `pyproject.toml`; do not add ad-hoc requirements files
- Keep Python changes compatible with the `requires-python` range in `pyproject.toml`

### Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

## Pull Request Process

1. **Update documentation** if adding new features
2. **Add tests** for new functionality
3. **Ensure all tests pass** before submitting
4. **Follow the PR template**
5. **Request review** from maintainers

## Issue Templates

### Bug Reports

- VS Code version
- QuackWrangler version
- Operating system
- Steps to reproduce
- Expected vs actual behavior

### Feature Requests

- Use case description
- Proposed solution
- Alternatives considered
- Additional context

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help newcomers feel welcome

## Questions?

Open a discussion on GitHub or reach out to maintainers.

Thank you for contributing!
