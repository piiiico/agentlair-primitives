// DRY scaffold generator for @agentlair/* npm + agentlair-* PyPI primitive stubs.
// One source of truth (primitives.ts) → 5 npm packages + 5 PyPI packages.
// Reservation-only v0.0.1 stubs. Each README must explain the primitive and link to the spec.
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { PRIMITIVES, type Primitive } from "./primitives.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const PKGS = path.join(ROOT, "packages");
const PY = path.join(ROOT, "py");
const VERSION = "0.0.1";

const APACHE_2_0 = `\nApache License\nVersion 2.0, January 2004\nhttp://www.apache.org/licenses/\n\nCopyright 2026 AgentLair (Håkon Åmdal / piiiico)\n\nLicensed under the Apache License, Version 2.0 (the "License");\nyou may not use this file except in compliance with the License.\nYou may obtain a copy of the License at\n\n    http://www.apache.org/licenses/LICENSE-2.0\n\nUnless required by applicable law or agreed to in writing, software\ndistributed under the License is distributed on an "AS IS" BASIS,\nWITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.\nSee the License for the specific language governing permissions and\nlimitations under the License.\n`;

function pkgJson(p: Primitive): string {
  const obj = {
    name: `@agentlair/${p.slug}`,
    version: VERSION,
    description: `AgentLair ${p.name} (${p.expansion}) primitive — reserved namespace stub. ${p.oneliner} See https://agentlair.dev`,
    type: "module",
    main: "./dist/index.js",
    module: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports: {
      ".": {
        import: "./dist/index.js",
        types: "./dist/index.d.ts",
      },
    },
    files: ["dist", "README.md", "LICENSE"],
    scripts: {
      build: "tsc",
      check: "tsc --noEmit",
      prepublishOnly: "tsc",
    },
    keywords: p.keywords,
    author: "AgentLair (piiiico)",
    license: "Apache-2.0",
    repository: {
      type: "git",
      url: "https://github.com/piiiico/agentlair-primitives",
    },
    homepage: `https://agentlair.dev/specs/${p.slug}`,
    bugs: {
      url: "https://github.com/piiiico/agentlair-primitives/issues",
    },
    engines: {
      node: ">=18.0.0",
    },
    devDependencies: {
      typescript: "^5.9.3",
    },
  };
  return JSON.stringify(obj, null, 2) + "\n";
}

function tsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        esModuleInterop: true,
        forceConsistentCasingInFileNames: true,
        skipLibCheck: true,
        declaration: true,
        declarationMap: true,
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        resolveJsonModule: true,
        isolatedModules: true,
        outDir: "./dist",
        rootDir: "./src",
        lib: ["ES2022"],
      },
      include: ["src/**/*.ts"],
      exclude: ["node_modules", "dist"],
    },
    null,
    2,
  ) + "\n";
}

function indexTs(p: Primitive): string {
  return `// @agentlair/${p.slug} — reserved namespace stub.
// ${p.name} (${p.expansion}). v1 with the actual primitive ships when ${p.ships_when}
// Spec: ${p.spec_link}

export const VERSION = "${VERSION}";
export const STATUS = "reserved" as const;
export const PRIMITIVE = ${JSON.stringify(p.name)} as const;
export const EXPANSION = ${JSON.stringify(p.expansion)} as const;
export const SPEC_URL = ${JSON.stringify(p.spec_link)} as const;
`;
}

function npmReadme(p: Primitive): string {
  return `# @agentlair/${p.slug}

${p.oneliner}

This is a placeholder package reserving the npm namespace \`@agentlair/${p.slug}\`. v0.0.1 contains a marker module only. v1 with the actual primitive ships when ${p.ships_when}

## What is ${p.name}?

${p.expansion}.

${p.paragraph}

## Why this stub exists

The five AgentLair primitives (PoPA, CBP, SCITT, TBRM, BCC) map 1:1 to the BCC schema v1 stake mediums and supporting infrastructure. Squatting these names later costs DMCA cycles; reserving them now costs a publish. See the BCC schema (https://agentlair.dev/specs/bcc) for how the five fit together.

## Roadmap

\`\`\`ts
import { VERSION, STATUS, PRIMITIVE, SPEC_URL } from "@agentlair/${p.slug}";
// VERSION === "0.0.1"
// STATUS === "reserved"
// PRIMITIVE === "${p.name}"
\`\`\`

When v1 lands, this package will ship the typed schema, a verifier client, and helper functions for issuing and consuming ${p.name} credentials against the AgentLair API.

## Reference

- Spec: ${p.spec_link}
- AgentLair: https://agentlair.dev
- Source: https://github.com/piiiico/agentlair-primitives

## License

Apache-2.0
`;
}

function pyReadme(p: Primitive): string {
  return `# agentlair-${p.slug}

${p.oneliner}

Placeholder package reserving the PyPI namespace \`agentlair-${p.slug}\`. v0.0.1 contains a marker module only. v1 ships when ${p.ships_when}

## What is ${p.name}?

${p.expansion}.

${p.paragraph}

## Roadmap

\`\`\`python
from agentlair_${p.slug.replace(/-/g, "_")} import VERSION, STATUS, PRIMITIVE, SPEC_URL
# VERSION == "0.0.1"
# STATUS == "reserved"
# PRIMITIVE == "${p.name}"
\`\`\`

## Reference

- Spec: ${p.spec_link}
- AgentLair: https://agentlair.dev
- Source: https://github.com/piiiico/agentlair-primitives

## License

Apache-2.0
`;
}

function pyInit(p: Primitive): string {
  const modName = `agentlair_${p.slug.replace(/-/g, "_")}`;
  return `"""${modName} — reserved namespace stub.

${p.name} (${p.expansion}). v1 ships when ${p.ships_when}
Spec: ${p.spec_link}
"""

VERSION = "${VERSION}"
STATUS = "reserved"
PRIMITIVE = "${p.name}"
EXPANSION = "${p.expansion}"
SPEC_URL = "${p.spec_link}"

__version__ = VERSION
__all__ = ["VERSION", "STATUS", "PRIMITIVE", "EXPANSION", "SPEC_URL"]
`;
}

function pyProject(p: Primitive): string {
  const modName = `agentlair_${p.slug.replace(/-/g, "_")}`;
  return `[build-system]
requires = ["setuptools>=68", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "agentlair-${p.slug}"
version = "${VERSION}"
description = "AgentLair ${p.name} (${p.expansion}) primitive — reserved namespace stub. ${p.oneliner}"
readme = "README.md"
requires-python = ">=3.9"
license = { text = "Apache-2.0" }
authors = [
  { name = "AgentLair (piiiico)", email = "ops@agentlair.dev" }
]
keywords = ${JSON.stringify(p.keywords)}
classifiers = [
  "Development Status :: 1 - Planning",
  "Intended Audience :: Developers",
  "License :: OSI Approved :: Apache Software License",
  "Programming Language :: Python :: 3",
  "Programming Language :: Python :: 3 :: Only",
  "Topic :: Software Development :: Libraries",
]

[project.urls]
Homepage = "${p.spec_link}"
Repository = "https://github.com/piiiico/agentlair-primitives"
"Bug Tracker" = "https://github.com/piiiico/agentlair-primitives/issues"

[tool.setuptools.packages.find]
include = ["${modName}*"]
exclude = ["tests*"]
`;
}

async function ensure(dir: string) {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

async function writeIfChanged(file: string, content: string) {
  await writeFile(file, content, "utf8");
}

async function main() {
  await ensure(PKGS);
  await ensure(PY);

  for (const p of PRIMITIVES) {
    // ---------- npm package ----------
    const npmDir = path.join(PKGS, p.slug);
    const npmSrc = path.join(npmDir, "src");
    await ensure(npmSrc);
    await writeIfChanged(path.join(npmDir, "package.json"), pkgJson(p));
    await writeIfChanged(path.join(npmDir, "tsconfig.json"), tsConfig());
    await writeIfChanged(path.join(npmDir, "README.md"), npmReadme(p));
    await writeIfChanged(path.join(npmDir, "LICENSE"), APACHE_2_0);
    await writeIfChanged(path.join(npmSrc, "index.ts"), indexTs(p));

    // ---------- PyPI package ----------
    const pyDir = path.join(PY, p.slug);
    const modName = `agentlair_${p.slug.replace(/-/g, "_")}`;
    const pyMod = path.join(pyDir, modName);
    await ensure(pyMod);
    await writeIfChanged(path.join(pyDir, "pyproject.toml"), pyProject(p));
    await writeIfChanged(path.join(pyDir, "README.md"), pyReadme(p));
    await writeIfChanged(path.join(pyDir, "LICENSE"), APACHE_2_0);
    await writeIfChanged(path.join(pyMod, "__init__.py"), pyInit(p));

    console.log(`generated @agentlair/${p.slug}  +  agentlair-${p.slug}`);
  }
}

await main();
