parser-treesitter.ts - Header parser (fast)
parser-libclang.ts - Header parser (accurate)
parser-index.ts - Shared module
tracer.ts - 🆕 Function call tracer
# 3. Parse a header
npx ts-node parser-index.ts ./myheader.h

# 4. Trace function calls
npx ts-node tracer.ts chrome ./api.h
npx ts-node tracer.ts safari ./WebKit.h

tsconfig
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "moduleResolution": "node",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "isolatedModules": true
  },
  "include": [
    "*.ts"
  ],
  "exclude": [
    "node_modules",
    "dist"
  ]
}
