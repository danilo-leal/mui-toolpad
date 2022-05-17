import { createComponent, ToolpadComponent, TOOLPAD_COMPONENT } from '@mui/toolpad-core';
import * as React from 'react';
import * as ReactIs from 'react-is';
import { transform } from 'sucrase';
import { findImports, isAbsoluteUrl } from '../utils/strings';

async function resolveValues(input: Map<string, Promise<unknown>>): Promise<Map<string, unknown>> {
  const resolved = await Promise.all(input.values());
  return new Map(Array.from(input.keys(), (key, i) => [key, resolved[i]]));
}

async function createRequire(urlImports: string[]) {
  const modules = await resolveValues(
    new Map<string, any>([
      ['react', import('react')],
      ['react-dom', import('react-dom')],
      ['@mui/toolpad-core', import(`@mui/toolpad-core`)],
      ['@mui/material', import('@mui/material')],
      ['@mui/material/Button', import('@mui/material/Button')],
      // ... TODO: All @mui/material imports + custom solution for icons
      ...urlImports.map((url) => [url, import(/* webpackIgnore: true */ url)] as const),
    ]),
  );

  const require = (moduleId: string): unknown => {
    const module = modules.get(moduleId);
    if (module && typeof module === 'object') {
      // ESM interop
      return { ...module, __esModule: true };
    }
    throw new Error(`Can't resolve module "${moduleId}"`);
  };

  return require;
}

function ensureToolpadComponent<P>(Component: React.ComponentType<P>): ToolpadComponent<P> {
  if ((Component as any)[TOOLPAD_COMPONENT]) {
    return Component as ToolpadComponent<P>;
  }
  return createComponent(Component);
}

export default async function createCodeComponent(src: string): Promise<ToolpadComponent> {
  const imports = findImports(src).filter((maybeUrl) => isAbsoluteUrl(maybeUrl));

  const compiled = transform(src, {
    transforms: ['jsx', 'typescript', 'imports'],
  });

  const require = await createRequire(imports);

  const exports: any = {};

  const globals = {
    exports,
    module: { exports },
    require,
  };

  const instantiateModuleCode = `
    (${Object.keys(globals).join(', ')}) => {
      ${compiled.code}
    }
  `;

  // eslint-disable-next-line no-eval
  const instantiateModule = (0, eval)(instantiateModuleCode);

  instantiateModule(...Object.values(globals));

  const Component: unknown = exports.default;

  if (!ReactIs.isValidElementType(Component) || typeof Component === 'string') {
    throw new Error(`No React Component exported.`);
  }

  return ensureToolpadComponent(Component);
}