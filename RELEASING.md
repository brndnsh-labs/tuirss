# Releasing tuirss

Releases are automatic once you push a version tag. GitHub Actions runs
the tests and then GoReleaser, which builds Linux and macOS binaries (Intel
and ARM) and publishes them on the
[Releases page](https://github.com/brndnsh-labs/tuirss/releases) along with
checksums and a changelog.

## Cutting a release

1. Make sure `master` is green: the CI check on the latest commit on GitHub
   should be a check mark.
2. Pick the version, using [semver](https://semver.org) (`vMAJOR.MINOR.PATCH`):
   - fixes only → bump PATCH (`v0.1.0` → `v0.1.1`)
   - new features → bump MINOR (`v0.1.1` → `v0.2.0`)
   - while MAJOR is `0`, breaking changes are allowed in MINOR bumps
3. Tag and push:
   ```sh
   git tag -a v0.1.0 -m "v0.1.0"
   git push origin v0.1.0
   ```
4. Watch it run under the repo's **Actions** tab. A few minutes later the
   release appears on the Releases page, and
   `go install github.com/brndnsh-labs/tuirss/cmd/tuirss@latest` picks it up.

## If something goes wrong

- **Tests fail in the release run:** nothing is published. Fix the problem on
  `master`, then move the tag to the fixed commit:
  ```sh
  git tag -d v0.1.0 && git push origin :refs/tags/v0.1.0   # delete it locally and on GitHub
  git tag -a v0.1.0 -m "v0.1.0" && git push origin v0.1.0  # re-tag the fixed commit
  ```
- **The release was published but is broken:** don't reuse the version
  number, since people may already have downloaded it, and Go's module proxy
  caches tagged versions permanently. Fix it and release the next PATCH
  version.

## Trying a release locally

The CI "Release dry run" job does this on every push. To do it yourself:

```sh
go run github.com/goreleaser/goreleaser/v2@latest release --snapshot --clean
ls dist/
```

`--snapshot` builds everything but publishes nothing.
