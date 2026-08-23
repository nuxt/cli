import type { CommandDef, Resolvable } from 'citty'

import { renderUsage } from 'citty'
import { describe, expect, it } from 'vitest'

import { commands } from '../../src/commands'
import { main } from '../../src/main'

async function resolve(def: Resolvable<CommandDef>): Promise<CommandDef> {
  return typeof def === 'function' ? await def() : def
}

async function usage(def: Resolvable<CommandDef>, parent?: Resolvable<CommandDef>): Promise<string> {
  const rendered = await renderUsage(await resolve(def), parent ? await resolve(parent) : undefined)
  return rendered.replace(/v\d+\.\d+\.\d[^\s)]*/g, 'v0.0.0')
}

async function subCommand(parent: Resolvable<CommandDef>, name: string): Promise<CommandDef> {
  const resolved = await resolve(parent)
  const subCommands = await (typeof resolved.subCommands === 'function' ? resolved.subCommands() : resolved.subCommands)
  return subCommands![name] as CommandDef
}

describe('help', () => {
  it('nuxt', async () => {
    expect(await usage(main)).toMatchInlineSnapshot(`
      "Nuxt CLI (nuxt v0.0.0)

      USAGE nuxt [OPTIONS] [COMMAND] add|add-template|analyze|build|cleanup|curl|dev|devtools|docs|generate|info|module|prepare|preview|task|test|typecheck|upgrade

      ARGUMENTS

        COMMAND    

      OPTIONS

        --cwd=<directory>    Specify the root directory of your Nuxt project

      COMMANDS

                 add    Add Nuxt modules and layers                                     
        add-template    Create a new template file.                                     
             analyze    Build Nuxt and analyze production bundle (experimental)         
               build    Build Nuxt for production deployment                            
             cleanup    Clean up generated Nuxt files and caches                        
                curl    Send an HTTP request to your running Nuxt dev server            
                 dev    Run Nuxt development server                                     
            devtools    Enable or disable devtools in a Nuxt project                    
                docs    Search or open the Nuxt documentation                           
            generate    Build Nuxt and prerender all routes                             
                info    Get information about Nuxt project                              
              module    Manage Nuxt modules                                             
             prepare    Prepare Nuxt for development/build                              
             preview    Launches Nitro server for local testing after \`nuxt build\`.     
                task    List and run Nitro tasks on your dev server                     
                test    Run tests                                                       
           typecheck    Runs type-checking throughout your app using \`vue-tsc\` or Golar.
             upgrade    Upgrade Nuxt                                                    

      Use nuxt <command> --help for more information about a command."
    `)
  })

  it('nuxt add', async () => {
    expect(await usage(commands.add, main)).toMatchInlineSnapshot(`
      "Add Nuxt modules and layers (nuxt add v0.0.0)

      USAGE nuxt add [OPTIONS] <MODULENAME...>

      ARGUMENTS

        MODULENAME...    Specify one or more modules or layers to install by name, separated by spaces (Required)

      OPTIONS

                                         --cwd=<directory>    Specify the root directory of your Nuxt project (Default: .)
                          --logLevel=<silent|info|verbose>    Specify build-time log level                                
                                             --skipInstall    Skip npm install                                            
                                              --skipConfig    Skip nuxt.config.ts update                                  
                                                     --dev    Install modules as dev dependencies                         
        --packageManager=<npm|pnpm|yarn|bun|deno|aube|nub>    Package manager to install with                             
      "
    `)
  })

  it('nuxt add-template', async () => {
    expect(await usage(commands['add-template'], main)).toMatchInlineSnapshot(`
      "Create a new template file. (nuxt add-template v0.0.0)

      USAGE nuxt add-template [OPTIONS] <TEMPLATE> <NAME>

      ARGUMENTS

        TEMPLATE=<api|app|app-config|component|composable|error|layer|layout|middleware|module|page|plugin|server-middleware|server-plugin|server-route|server-util>    Specify which template to generate (Required)
                                                                                                                                                                NAME    Specify name of the generated file (Required)

      OPTIONS

                                                      --cwd=<directory>    Specify the root directory of your Nuxt project (Default: .)
                                       --logLevel=<silent|info|verbose>    Specify build-time log level                                
                                                                --force    Overwrite the file if it already exists (Default: false)    
                                                 --mode=<client|server>    Add a client or server suffix to a component or plugin      
        --method=<connect|delete|get|head|options|patch|post|put|trace>    Add an HTTP method suffix to an API route                   
                                                               --global    Create global route middleware                              
                                                                  --api    Create a server route in the API directory                  
                                                                --pages    Include NuxtPage and NuxtLayout in the app template         
                                                               --client    Shorthand for \`--mode client\`                               
                                                               --server    Shorthand for \`--mode server\`                               
                                                              --connect    Shorthand for \`--method connect\`                            
                                                               --delete    Shorthand for \`--method delete\`                             
                                                                  --get    Shorthand for \`--method get\`                                
                                                                 --head    Shorthand for \`--method head\`                               
                                                              --options    Shorthand for \`--method options\`                            
                                                                 --post    Shorthand for \`--method post\`                               
                                                                  --put    Shorthand for \`--method put\`                                
                                                                --trace    Shorthand for \`--method trace\`                              
                                                                --patch    Shorthand for \`--method patch\`                              
      "
    `)
  })

  it('nuxt analyze', async () => {
    expect(await usage(commands.analyze, main)).toMatchInlineSnapshot(`
      "Build Nuxt and analyze production bundle (experimental) (nuxt analyze v0.0.0)

      USAGE nuxt analyze [OPTIONS] [ROOTDIR]

      ARGUMENTS

        ROOTDIR    The root directory of your Nuxt project (default: .)

      OPTIONS

        --logLevel=<silent|info|verbose>    Specify build-time log level                                                                                     
                      --dotenv=<path>...    Path to \`.env\` file to load, relative to the root directory. Can be repeated, with later files taking precedence.
           -e, --extends=<layer-name>...    Extend from a Nuxt layer                                                                                         
                           --name=<name>    Name of the analysis (Default: default)                                                                          
                                 --serve    Serve the analysis results (Default: true)                                                                       
                              --no-serve    Skip serving the analysis results                                                                                
                             --prerender    Prerender routes while analyzing (Default: false)                                                                
      "
    `)
  })

  it('nuxt build', async () => {
    expect(await usage(commands.build, main)).toMatchInlineSnapshot(`
      "Build Nuxt for production deployment (nuxt build v0.0.0)

      USAGE nuxt build [OPTIONS] [ROOTDIR]

      ARGUMENTS

        ROOTDIR    The root directory of your Nuxt project (default: .)

      OPTIONS

        --logLevel=<silent|info|verbose>    Specify build-time log level                                                                                                                        
                             --prerender    Build Nuxt and prerender static routes                                                                                                              
                 --preset=<nitro-preset>    Nitro server preset (e.g. \`node-server\`, \`vercel\`, \`netlify\`)                                                                                       
                      --dotenv=<path>...    Path to \`.env\` file to load, relative to the root directory. Can be repeated, with later files taking precedence.                                   
                 --envName=<environment>    The environment to use when resolving configuration overrides (default is \`production\` when building, and \`development\` when running the dev server)
           -e, --extends=<layer-name>...    Extend from a Nuxt layer                                                                                                                            
                     --profile=<verbose>    Profile performance, writing a V8 CPU profile and a JSON report on exit. Use \`--profile=verbose\` for a full console report.                         
      "
    `)
  })

  it('nuxt cleanup', async () => {
    expect(await usage(commands.cleanup, main)).toMatchInlineSnapshot(`
      "Clean up generated Nuxt files and caches (nuxt cleanup v0.0.0)

      USAGE nuxt cleanup [OPTIONS] [ROOTDIR]

      ARGUMENTS

        ROOTDIR    The root directory of your Nuxt project (default: .)
      "
    `)
  })

  it('nuxt _dev', async () => {
    expect(await usage(commands._dev, main)).toMatchInlineSnapshot(`
      "Run Nuxt development server (internal command to start child process) (nuxt _dev v0.0.0)

      USAGE nuxt _dev [OPTIONS] [ROOTDIR]

      ARGUMENTS

        ROOTDIR    The root directory of your Nuxt project (default: .)

      OPTIONS

        --logLevel=<silent|info|verbose>    Specify build-time log level                                                                                                                        
                 --envName=<environment>    The environment to use when resolving configuration overrides (default is \`production\` when building, and \`development\` when running the dev server)
                      --dotenv=<path>...    Path to \`.env\` file to load, relative to the root directory. Can be repeated, with later files taking precedence.                                   
                                 --clear    Clear console on restart                                                                                                                            
                              --no-clear    Disable clear console on restart                                                                                                                    
      "
    `)
  })

  it('nuxt dev', async () => {
    expect(await usage(commands.dev, main)).toMatchInlineSnapshot(`
      "Run Nuxt development server (nuxt dev v0.0.0)

      USAGE nuxt dev [OPTIONS] [ROOTDIR]

      ARGUMENTS

        ROOTDIR    The root directory of your Nuxt project (default: .)

      OPTIONS

        --logLevel=<silent|info|verbose>    Specify build-time log level                                                                                                                        
                      --dotenv=<path>...    Path to \`.env\` file to load, relative to the root directory. Can be repeated, with later files taking precedence.                                   
                 --envName=<environment>    The environment to use when resolving configuration overrides (default is \`production\` when building, and \`development\` when running the dev server)
           -e, --extends=<layer-name>...    Extend from a Nuxt layer                                                                                                                            
                               --inspect    Enable the Node.js inspector for the process serving your app (\`--inspect=[host:]port\`)                                                             
                           --inspect-brk    Enable the Node.js inspector and wait for a debugger to attach (\`--inspect-brk=[host:]port\`)                                                        
                                   --tui    Interactive terminal UI (pinned status panel, folded logs and single-key shortcuts) (Default: true)                                                 
                                --no-tui    Disable the interactive terminal UI and stream logs instead                                                                                         
                                 --clear    Clear console on restart (Default: false)                                                                                                           
                              -f, --fork    Serve the app from a forked child process (on by default wherever the runtime supports it) (Default: false)                                         
                       --no-f, --no-fork    Disable forked mode                                                                                                                                 
                       -p, --port=<port>    Port to listen on (default: \`NUXT_PORT || NITRO_PORT || PORT || nuxtOptions.devServer.port\`)                                                        
                              --takeover    Stop a dev server already running on this project and take its place                                                                                
                           --no-takeover    Never stop a dev server already running on this project                                                                                             
                            --strictPort    Exit if the requested port is unavailable instead of using another one (Default: false)                                                             
                       -h, --host=<host>    Host to listen on (default: \`NUXT_HOST || NITRO_HOST || HOST || nuxtOptions.devServer?.host\`)                                                       
                              -o, --open    Open the URL in the browser (Default: false)                                                                                                        
                   --open.url=<url|path>    Path or URL to open instead of the dev server root                                                                                                  
                             --clipboard    Copy the URL to the clipboard (Default: false)                                                                                                      
                                    --qr    Print a QR code for the public URL (enabled by default when one is available)                                                                       
                                --tunnel    Expose the server via a Cloudflare quick tunnel                                                                                                     
                                --public    Listen on all network interfaces                                                                                                                    
                       --publicURL=<url>    Public URL to display (used for QR code and clipboard)                                                                                              
                                 --https    Enable HTTPS with a locally-trusted development certificate                                                                                         
                     --https.cert=<path>    Path to TLS certificate                                                                                                                             
                      --https.key=<path>    Path to TLS key                                                                                                                                     
                      --https.pfx=<path>    Path to PKCS#12 (.p12/.pfx) keystore                                                                                                                
         --https.passphrase=<passphrase>    Passphrase for the TLS key or keystore                                                                                                              
             --https.validityDays=<days>    Validity in days for a generated self-signed certificate                                                                                            
             --https.domains=<domain>...    Domain for a generated certificate. Can be repeated, or given as a comma-separated list.                                                            
                     --profile=<verbose>    Profile performance, writing a V8 CPU profile and a JSON report on exit. Use \`--profile=verbose\` for a full console report.                         
      "
    `)
  })

  it('nuxt devtools', async () => {
    expect(await usage(commands.devtools, main)).toMatchInlineSnapshot(`
      "Enable or disable devtools in a Nuxt project (nuxt devtools v0.0.0)

      USAGE nuxt devtools [OPTIONS] <COMMAND> [ROOTDIR]

      ARGUMENTS

        COMMAND=<enable|disable>    Command to run (Required)                           
                         ROOTDIR    The root directory of your Nuxt project (default: .)
      "
    `)
  })

  it('nuxt docs', async () => {
    expect(await usage(commands.docs, main)).toMatchInlineSnapshot(`
      "Search or open the Nuxt documentation (nuxt docs v0.0.0)

      USAGE nuxt docs [OPTIONS] [QUERY]

      ARGUMENTS

        QUERY    Words to search the documentation for

      OPTIONS

        --cwd=<directory>    Specify the root directory of your Nuxt project (Default: .)
                   --open    Open the best match in a browser (Default: true)            
                --no-open    Print the matching pages without opening a browser          
      "
    `)
  })

  it('nuxt generate', async () => {
    expect(await usage(commands.generate, main)).toMatchInlineSnapshot(`
      "Build Nuxt and prerender all routes (nuxt generate v0.0.0)

      USAGE nuxt generate [OPTIONS] [ROOTDIR]

      ARGUMENTS

        ROOTDIR    The root directory of your Nuxt project (default: .)

      OPTIONS

        --logLevel=<silent|info|verbose>    Specify build-time log level                                                                                                                        
                 --preset=<nitro-preset>    Nitro server preset (e.g. \`node-server\`, \`vercel\`, \`netlify\`)                                                                                       
                      --dotenv=<path>...    Path to \`.env\` file to load, relative to the root directory. Can be repeated, with later files taking precedence.                                   
                 --envName=<environment>    The environment to use when resolving configuration overrides (default is \`production\` when building, and \`development\` when running the dev server)
           -e, --extends=<layer-name>...    Extend from a Nuxt layer                                                                                                                            
                     --profile=<verbose>    Profile performance, writing a V8 CPU profile and a JSON report on exit. Use \`--profile=verbose\` for a full console report.                         
      "
    `)
  })

  it('nuxt info', async () => {
    expect(await usage(commands.info, main)).toMatchInlineSnapshot(`
      "Get information about Nuxt project (nuxt info v0.0.0)

      USAGE nuxt info [OPTIONS] [ROOTDIR]

      ARGUMENTS

        ROOTDIR    The root directory of your Nuxt project (default: .)

      OPTIONS

        --json    Print project info as JSON
      "
    `)
  })

  it('nuxt init', async () => {
    expect(await usage(commands.init, main)).toMatchInlineSnapshot(`
      "Scaffold a fresh project (moved to create-nuxt) (nuxt init v0.0.0)

      USAGE nuxt init 
      "
    `)
  })

  it('nuxt module', async () => {
    expect(await usage(commands.module, main)).toMatchInlineSnapshot(`
      "Manage Nuxt modules (nuxt module v0.0.0)

      USAGE nuxt module add|remove|search

      COMMANDS

           add    Add Nuxt modules      
        remove    Remove Nuxt modules   
        search    Search in Nuxt modules

      Use nuxt module <command> --help for more information about a command."
    `)
  })

  it('nuxt prepare', async () => {
    expect(await usage(commands.prepare, main)).toMatchInlineSnapshot(`
      "Prepare Nuxt for development/build (nuxt prepare v0.0.0)

      USAGE nuxt prepare [OPTIONS] [ROOTDIR]

      ARGUMENTS

        ROOTDIR    The root directory of your Nuxt project (default: .)

      OPTIONS

                      --dotenv=<path>...    Path to \`.env\` file to load, relative to the root directory. Can be repeated, with later files taking precedence.                                   
        --logLevel=<silent|info|verbose>    Specify build-time log level                                                                                                                        
                 --envName=<environment>    The environment to use when resolving configuration overrides (default is \`production\` when building, and \`development\` when running the dev server)
           -e, --extends=<layer-name>...    Extend from a Nuxt layer                                                                                                                            
      "
    `)
  })

  it('nuxt preview', async () => {
    expect(await usage(commands.preview, main)).toMatchInlineSnapshot(`
      "Launches Nitro server for local testing after \`nuxt build\`. (nuxt preview v0.0.0)

      USAGE nuxt preview [OPTIONS] [ROOTDIR]

      ARGUMENTS

        ROOTDIR    The root directory of your Nuxt project (default: .)

      OPTIONS

        --logLevel=<silent|info|verbose>    Specify build-time log level                                                                                                                        
                 --envName=<environment>    The environment to use when resolving configuration overrides (default is \`production\` when building, and \`development\` when running the dev server)
           -e, --extends=<layer-name>...    Extend from a Nuxt layer                                                                                                                            
                       -p, --port=<port>    Port to listen on (default: \`NUXT_PORT || NITRO_PORT || PORT\`)                                                                                      
                       -h, --host=<host>    Host to listen on (default: \`NUXT_HOST || NITRO_HOST || HOST\`)                                                                                      
                      --dotenv=<path>...    Path to \`.env\` file to load, relative to the root directory. Can be repeated, with later files taking precedence.                                   
      "
    `)
  })

  it('nuxt start', async () => {
    expect(await usage(commands.start, main)).toMatchInlineSnapshot(`
      "Launches Nitro server for local testing after \`nuxt build\`. (nuxt start v0.0.0)

      USAGE nuxt start [OPTIONS] [ROOTDIR]

      ARGUMENTS

        ROOTDIR    The root directory of your Nuxt project (default: .)

      OPTIONS

        --logLevel=<silent|info|verbose>    Specify build-time log level                                                                                                                        
                 --envName=<environment>    The environment to use when resolving configuration overrides (default is \`production\` when building, and \`development\` when running the dev server)
           -e, --extends=<layer-name>...    Extend from a Nuxt layer                                                                                                                            
                       -p, --port=<port>    Port to listen on (default: \`NUXT_PORT || NITRO_PORT || PORT\`)                                                                                      
                       -h, --host=<host>    Host to listen on (default: \`NUXT_HOST || NITRO_HOST || HOST\`)                                                                                      
                      --dotenv=<path>...    Path to \`.env\` file to load, relative to the root directory. Can be repeated, with later files taking precedence.                                   
      "
    `)
  })

  it('nuxt test', async () => {
    expect((await usage(commands.test, main)).replaceAll(/ +$/gm, '')).toMatchInlineSnapshot(`
      "Run tests (nuxt test v0.0.0)

      USAGE nuxt test [OPTIONS] [ROOTDIR]

      ARGUMENTS

        ROOTDIR    The root directory of your Nuxt project (default: .)

      OPTIONS

          --dev    Run in dev mode
        --watch    Watch mode
      "
    `)
  })

  it('nuxt typecheck', async () => {
    expect(await usage(commands.typecheck, main)).toMatchInlineSnapshot(`
      "Runs type-checking throughout your app using \`vue-tsc\` or Golar. (nuxt typecheck v0.0.0)

      USAGE nuxt typecheck [OPTIONS] [ROOTDIR]

      ARGUMENTS

        ROOTDIR    The root directory of your Nuxt project (default: .)

      OPTIONS

        --logLevel=<silent|info|verbose>    Specify build-time log level                                                                                     
                      --dotenv=<path>...    Path to \`.env\` file to load, relative to the root directory. Can be repeated, with later files taking precedence.
           -e, --extends=<layer-name>...    Extend from a Nuxt layer                                                                                         
               --checker=<vue-tsc|golar>    Type checker to use                                                                                              
                             -b, --build    Type-check in build mode, using TypeScript project references (detected automatically by default)                
                      --no-b, --no-build    Type-check without TypeScript project references                                                                 
      "
    `)
  })

  it('nuxt upgrade', async () => {
    expect(await usage(commands.upgrade, main)).toMatchInlineSnapshot(`
      "Upgrade Nuxt (nuxt upgrade v0.0.0)

      USAGE nuxt upgrade [OPTIONS] [ROOTDIR]

      ARGUMENTS

        ROOTDIR    The root directory of your Nuxt project (default: .)

      OPTIONS

                                   --logLevel=<silent|info|verbose>    Specify build-time log level                       
                                                           --dedupe    Dedupe dependencies after upgrading                
                                                        -f, --force    Force upgrade to recreate lockfile and node_modules
        -ch, --channel=<stable|nightly|v3|v4|v4-nightly|v3-nightly>    Specify a channel to install from (Default: stable)
      "
    `)
  })

  it('nuxt module add', async () => {
    expect(await usage(await subCommand(commands.module, 'add'), commands.module)).toMatchInlineSnapshot(`
      "Add Nuxt modules (module add)

      USAGE module add [OPTIONS] <MODULENAME...>

      ARGUMENTS

        MODULENAME...    Specify one or more modules to install by name, separated by spaces (Required)

      OPTIONS

                                         --cwd=<directory>    Specify the root directory of your Nuxt project (Default: .)
                          --logLevel=<silent|info|verbose>    Specify build-time log level                                
                                             --skipInstall    Skip npm install                                            
                                              --skipConfig    Skip nuxt.config.ts update                                  
                                                     --dev    Install modules as dev dependencies                         
        --packageManager=<npm|pnpm|yarn|bun|deno|aube|nub>    Package manager to install with                             
      "
    `)
  })

  it('nuxt module remove', async () => {
    expect(await usage(await subCommand(commands.module, 'remove'), commands.module)).toMatchInlineSnapshot(`
      "Remove Nuxt modules (module remove)

      USAGE module remove [OPTIONS] [MODULENAME...]

      ARGUMENTS

        MODULENAME...    Specify one or more modules to remove by name, separated by spaces

      OPTIONS

                       --cwd=<directory>    Specify the root directory of your Nuxt project (Default: .)
        --logLevel=<silent|info|verbose>    Specify build-time log level                                
                           --skipInstall    Skip dependency uninstall                                   
                            --skipConfig    Skip nuxt.config.ts update                                  
      "
    `)
  })

  it('nuxt module search', async () => {
    expect(await usage(await subCommand(commands.module, 'search'), commands.module)).toMatchInlineSnapshot(`
      "Search in Nuxt modules (module search)

      USAGE module search [OPTIONS] <QUERY>

      ARGUMENTS

        QUERY    keywords to search for (Required)

      OPTIONS

                --cwd=<directory>    Specify the root directory of your Nuxt project (Default: .)                      
        --nuxtVersion=<3|4|4.2.0>    Filter by Nuxt version and list compatible modules only (auto detected by default)
                           --json    Print output as JSON                                                              
      "
    `)
  })
})
