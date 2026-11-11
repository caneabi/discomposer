# Releasing

Both packages are published from GitHub Actions with trusted publishing, so no API tokens are stored in the repository.

## One-time setup

1. **PyPI:** on pypi.org, add a pending trusted publisher for the project `discomposer`: owner `caneabi`, repository `discomposer`, workflow `release.yml`, environment `pypi`.
2. **npm:** publish `0.1.0` once by hand (`cd packages/js && npm publish`), then on npmjs.com under the package settings add a trusted publisher for GitHub Actions: repository `caneabi/discomposer`, workflow `release.yml`, environment `npm`.
3. **GitHub:** create the environments `pypi` and `npm` under Settings → Environments (optionally with required reviewers).

## Release

1. Bump the version in `packages/python/pyproject.toml` and/or `packages/js/package.json`.
2. Commit, then tag:
   - Python: `git tag py-v0.1.1`
   - JavaScript: `git tag js-v0.1.1`
3. `git push --tags`. The release workflow runs the tests and publishes the matching package.

The tag version must match the package version, otherwise the workflow stops before publishing.
