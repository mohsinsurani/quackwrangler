# Release and Marketplace Publishing

This guide is for QuackWrangler maintainers. Contributors should record normal changes under `Unreleased` and must not change versions, package a release, create tags, or publish without explicit maintainer approval.

## Before packaging

1. Confirm the version being prepared and the latest published Marketplace version.
2. Move the relevant `Unreleased` changelog entries into a dated version section.
3. Verify that `package.json` and `package-lock.json` contain the approved version.
4. Check the README, Marketplace description, privacy wording, supported formats, screenshots, demo GIF, and release notes against the current code.
5. Complete [QA_CHECKLIST.md](QA_CHECKLIST.md), including the Extension Development Host checks.
6. Run the release gate:

   ```bash
   npm ci
   npm --prefix webview-ui ci
   npm run typecheck
   npm run lint
   npm test
   npm run build
   git diff --check
   ```

Do not continue if any check fails or the working tree contains unexplained changes.

## Marketplace access

The publisher ID in `package.json` must match the Marketplace publisher. QuackWrangler uses `quackwrangler`.

Create an Azure DevOps personal access token with only the Marketplace **Manage** scope required for publishing. Keep it in a password manager or a protected CI secret such as `VSCE_PAT`. Never place a token in source files, settings committed to Git, workflow text, shell history examples, screenshots, logs, issues, or release notes.

Authenticate locally only when necessary:

```bash
npx vsce login quackwrangler
```

## Build and inspect the VSIX

Packaging is allowed only after the owner approves the release candidate:

```bash
npm run package
```

Before publishing:

1. Inspect the VSIX contents and confirm that source fixtures, development files, credentials, and benchmark datasets are absent.
2. Confirm that `logo.png`, README assets, the bundled webview, and the correct DuckDB native files are present.
3. Install the VSIX using **Extensions: Install from VSIX...** in VS Code.
4. Repeat the release smoke tests in a clean Extension Development Host or VS Code profile.

## Publish

Publishing requires a second explicit approval after the VSIX has passed inspection and smoke testing:

```bash
npm run publish:marketplace
```

Alternatively, upload the approved VSIX through the [Visual Studio Marketplace publisher portal](https://marketplace.visualstudio.com/manage/publishers/).

After Marketplace verification completes:

1. Confirm that the listing, icon, README, version, installation, and extension activation work from the public Marketplace.
2. Commit the finalized changelog and version metadata if they are not already committed.
3. Create and push the matching Git tag and GitHub release.
4. Start a fresh `Unreleased` changelog section for subsequent work.

Never reuse a version that has already been published. If Marketplace verification fails, diagnose and correct the package, then publish a new approved patch version rather than replacing release history.

## References

- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Install from VSIX](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace#_install-from-a-vsix)
