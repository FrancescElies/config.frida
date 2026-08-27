parser-treesitter.ts - Header parser (fast)
parser-libclang.ts - Header parser (accurate)
parser-index.ts - Shared module
tracer.ts - 🆕 Function call tracer
# 3. Parse a header
npx tsx parser-index.ts ./myheader.h

# 4. Trace function calls
npx tsx tracer.ts chrome ./api.h
npx tsx tracer.ts safari ./WebKit.h
npx tsx tracer.ts $MY_PID ./myapp.h
npx tsx tracer.ts chrome ./WebKit.h --output trace.json
xcode-select --install
sudo apt-get install build-essential python3

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

Example Workflow

    Parse headers

bash

   tsx parser-index.ts ./libcrypto.h > crypto_functions.json

    Find function names to trace

bash

   grep "name" crypto_functions.json | head -10

    Start tracing

bash

   tsx tracer.ts openssl ./libcrypto.h --output crypto_trace.json

    Analyze results

bash

   cat crypto_trace.json | jq '.[] | select(.type == "return")'
