# Third-party licenses

The root MIT license applies to original Accord code and documentation only.
Dependencies retain their own licenses; resolved versions and SPDX identifiers
are recorded in `package-lock.json`. Preserve applicable license and notice files
when redistributing dependencies or application bundles.

Bundled Manrope, IBM Plex Sans, and IBM Plex Mono fonts are licensed under the
SIL Open Font License 1.1. Their license texts remain in `public/help/fonts/`.
The Accord artwork is covered separately by [the brand policy](TRADEMARKS.md).

The lockfile includes Apache-2.0, MPL-2.0, and LGPL-3.0-or-later components as well
as MIT and other licenses. An MIT application license does not replace their
terms. Distribution-specific obligations must be reviewed before shipping a
compiled application or container; this preview distributes source and a lockfile.

## Source preview dependency review

This release ships Accord source, its lockfile and the bundled font/artwork assets;
it does not ship `node_modules`, compiled dependencies, or a container image.
Dependency sources are unmodified. All resolved packages declare license metadata.

- Next.js and React retain their MIT notices; the MCP SDK and Supabase packages
  retain the licenses supplied by their upstream packages.
- Lightning CSS and axe-core use MPL-2.0. Preserve their notices and provide the
  corresponding covered source if redistributing their covered compiled files.
- Sharp uses Apache-2.0; its platform-specific libvips packages include LGPL-3.0-or-later
  components. A future binary/container distribution needs the applicable notices,
  corresponding-source and relinking requirements reviewed for its actual contents.
- caniuse-lite includes browser support data from [Can I use](https://caniuse.com/)
  by Alexis Deveria and contributors, under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  Preserve this attribution and the upstream license when redistributing that data.
- Font license texts and copyright notices are retained beside every bundled font.
  The font packages are Manrope, IBM Plex Sans and IBM Plex Mono from Fontsource;
  no font files were modified by this release.

The artwork provenance is recorded in `public/brand/README.md` and
`public/brand/README-v2.md`: generated image assets and derived size/format exports.
The reserved-artwork policy does not assert third-party exclusivity or registration.
