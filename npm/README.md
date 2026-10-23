# ideacraft (npm package)

`npm install ideacraft` downloads the latest **IdeaCraft** Windows installer
from GitHub Releases and runs it **silently**. That's it - the desktop app is
installed for the current Windows user (no admin rights, no UAC), with Start
Menu + Desktop shortcuts. It also installs the WebView2 runtime automatically
if Windows is missing it.

After installing, launch the app with:

```
ideacraft            # global install
npx ideacraft        # local install
```

The package also provides:

| Command               | Action                                          |
| --------------------- | ----------------------------------------------- |
| `ideacraft install`   | Install or repair the app (retries the download) |
| `ideacraft uninstall` | Silent uninstall                                |
| `ideacraft where`     | Print the installed app path                    |
| `ideacraft --version` | Print package version                           |

## Environment overrides

| Variable                 | Meaning                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `IDEACRAFT_REPO=own/nm`  | Install from another GitHub repository                          |
| `IDEACRAFT_SKIP_INSTALL` | Skip the postinstall download entirely                          |
| `IDEACRAFT_STRICT=true`  | Make postinstall failures fail the whole `npm install`           |

## Before publishing this package

1. Make sure a GitHub Release exists at `aamirenic/ideacraft` with the asset
   `IdeaCraft_<version>_x64-setup.exe` (produced by `npm run build` in the app
   repo). Otherwise the postinstall has nothing to download.
2. Keep the version in sync with the app release you want npm users to get.
3. `npm publish` in this folder.

## Notes

- Install failures never break `npm install` (unless `IDEACRAFT_STRICT` is
  set). Users can fix a flaky network with `ideacraft install` later.
- On macOS/Linux the postinstall prints a pointer to build-from-source docs
  and exits 0.
