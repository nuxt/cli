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

      USAGE nuxt [OPTIONS] [COMMAND] add|add-template|analyze|build|cleanup|_dev|dev|devtools|generate|info|init|module|prepare|preview|start|test|typecheck|upgrade

      ARGUMENTS

        COMMAND    

      OPTIONS

        --cwd=<directory>    Specify the working directory (Default: .)

      COMMANDS

                 add    Add Nuxt modules                                                     
        add-template    Create a new template file.                                          
             analyze    Build Nuxt and analyze production bundle (experimental)              
               build    Build Nuxt for production deployment                                 
             cleanup    Clean up generated Nuxt files and caches                             
                _dev    Run Nuxt development server (internal command to start child process)
                 dev    Run Nuxt development server                                          
            devtools    Enable or disable devtools in a Nuxt project                         
            generate    Build Nuxt and prerender all routes                                  
                info    Get information about Nuxt project                                   
                init    Initialize a fresh project                                           
              module    Manage Nuxt modules                                                  
             prepare    Prepare Nuxt for development/build                                   
             preview    Launches Nitro server for local testing after \`nuxt build\`.          
               start    Launches Nitro server for local testing after \`nuxt build\`.          
                test    Run tests                                                            
           typecheck    Runs type-checking throughout your app using \`vue-tsc\` or Golar.     
             upgrade    Upgrade Nuxt                                                         

      Use nuxt <command> --help for more information about a command."
    `)
  })

  it('nuxt add', async () => {
    expect(await usage(commands.add, main)).toMatchInlineSnapshot(`
      "Add Nuxt modules (nuxt add v0.0.0)

      USAGE nuxt add [OPTIONS] <MODULENAME>

      ARGUMENTS

        MODULENAME    Specify one or more modules to install by name, separated by spaces (Required)

      OPTIONS

                         --cwd=<directory>    Specify the working directory (Default: .)                             
          --logLevel=<silent|info|verbose>    Specify build-time log level                                           
                             --skipInstall    Skip npm install                                                       
                              --skipConfig    Skip nuxt.config.ts update                                             
                                     --dev    Install modules as dev dependencies                                    
        --packageManager=<package_manager>    Package manager to install with (npm, aube, nub, pnpm, bun, yarn, deno)
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

                       --cwd=<directory>    Specify the working directory (Default: .)               
        --logLevel=<silent|info|verbose>    Specify build-time log level                             
                                 --force    Force override file if it already exists (Default: false)
      "
    `)
  })

  it('nuxt analyze', async () => {
    expect(await usage(commands.analyze, main)).toMatchInlineSnapshot(`
      "Build Nuxt and analyze production bundle (experimental) (nuxt analyze v0.0.0)

      USAGE nuxt analyze [OPTIONS] [ROOTDIR]

      ARGUMENTS

        ROOTDIR    Specifies the working directory (Default: .)

      OPTIONS

                       --cwd=<directory>    Specify the working directory, this takes precedence over ROOTDIR
        --logLevel=<silent|info|verbose>    Specify build-time log level                                     
                       --dotenv=<dotenv>    Path to \`.env\` file to load, relative to the root directory      
              -e, --extends=<layer-name>    Extend from a Nuxt layer                                         
                           --name=<name>    Name of the analysis (Default: default)                          
                                 --serve    Serve the analysis results (Default: true)                       
                              --no-serve    Skip serving the analysis results                                
      "
    `)
  })

  it('nuxt build', async () => {
    expect(await usage(commands.build, main)).toMatchInlineSnapshot(`
      "Build Nuxt for production deployment (nuxt build v0.0.0)

      USAGE nuxt build [OPTIONS] [ROOTDIR]

      ARGUMENTS

        ROOTDIR    Specifies the working directory (Default: .)

      OPTIONS

                       --cwd=<directory>    Specify the working directory, this takes precedence over ROOTDIR                                                                                   
        --logLevel=<silent|info|verbose>    Specify build-time log level                                                                                                                        
                             --prerender    Build Nuxt and prerender static routes                                                                                                              
                       --preset=<preset>    Nitro server preset                                                                                                                                 
                       --dotenv=<dotenv>    Path to \`.env\` file to load, relative to the root directory                                                                                         
                    --envName=<env_name>    The environment to use when resolving configuration overrides (default is \`production\` when building, and \`development\` when running the dev server)
              -e, --extends=<layer-name>    Extend from a Nuxt layer                                                                                                                            
                     --profile=<verbose>    Profile performance. Use --profile for CPU only, --profile=verbose for full report.                                                                 
      "
    `)
  })

  it('nuxt cleanup', async () => {
    expect(await usage(commands.cleanup, main)).toMatchInlineSnapshot(`
      "Clean up generated Nuxt files and caches (nuxt cleanup v0.0.0)

      USAGE nuxt cleanup [OPTIONS] [ROOTDIR]

      ARGUMENTS

        ROOTDIR    Specifies the working directory (Default: .)

      OPTIONS

        --cwd=<directory>    Specify the working directory, this takes precedence over ROOTDIR
      "
    `)
  })

  it('nuxt _dev', async () => {
    expect(await usage(commands._dev, main)).toMatchInlineSnapshot(`
      "Run Nuxt development server (internal command to start child process) (nuxt _dev v0.0.0)

      USAGE nuxt _dev [OPTIONS] [ROOTDIR]

      ARGUMENTS

        ROOTDIR    Specifies the working directory (Default: .)

      OPTIONS

                       --cwd=<directory>    Specify the working directory, this takes precedence over ROOTDIR                                                                                   
        --logLevel=<silent|info|verbose>    Specify build-time log level                                                                                                                        
                    --envName=<env_name>    The environment to use when resolving configuration overrides (default is \`production\` when building, and \`development\` when running the dev server)
                       --dotenv=<dotenv>    Path to \`.env\` file to load, relative to the root directory                                                                                         
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

        ROOTDIR    Specifies the working directory (Default: .)

      OPTIONS

                                 --cwd=<directory>    Specify the working directory, this takes precedence over ROOTDIR                                                                                   
                  --logLevel=<silent|info|verbose>    Specify build-time log level                                                                                                                        
                                 --dotenv=<dotenv>    Path to \`.env\` file to load, relative to the root directory                                                                                         
                              --envName=<env_name>    The environment to use when resolving configuration overrides (default is \`production\` when building, and \`development\` when running the dev server)
                        -e, --extends=<layer-name>    Extend from a Nuxt layer                                                                                                                            
                                         --inspect    Enable the Node.js inspector for the process serving your app (\`--inspect=[host:]port\`)                                                             
                                     --inspect-brk    Enable the Node.js inspector and wait for a debugger to attach (\`--inspect-brk=[host:]port\`)                                                        
                                           --clear    Clear console on restart (Default: false)                                                                                                           
                                        -f, --fork    Enable forked mode (Default: false)                                                                                                                 
                                 --no-f, --no-fork    Disable forked mode                                                                                                                                 
                                 -p, --port=<port>    Port to listen on (default: \`NUXT_PORT || NITRO_PORT || PORT || nuxtOptions.devServer.port\`)                                                        
                                      --strictPort    Exit if the requested port is unavailable instead of using another one (Default: false)                                                             
                                 -h, --host=<host>    Host to listen on (default: \`NUXT_HOST || NITRO_HOST || HOST || nuxtOptions.devServer?.host\`)                                                       
                                        -o, --open    Open the URL in the browser (Default: false)                                                                                                        
                             --open.url=<open_url>    Path or URL to open instead of the dev server root                                                                                                  
                                       --clipboard    Copy the URL to the clipboard (Default: false)                                                                                                      
                                              --qr    Print a QR code for the public URL (enabled by default when one is available)                                                                       
                                          --tunnel    Expose the server via a Cloudflare quick tunnel                                                                                                     
                                          --public    Listen on all network interfaces                                                                                                                    
                          --publicURL=<public_url>    Public URL to display (used for QR code and clipboard)                                                                                              
                                           --https    Enable HTTPS with a locally-trusted development certificate                                                                                         
                         --https.cert=<https_cert>    Path to TLS certificate                                                                                                                             
                           --https.key=<https_key>    Path to TLS key                                                                                                                                     
                           --https.pfx=<https_pfx>    Path to PKCS#12 (.p12/.pfx) keystore                                                                                                                
             --https.passphrase=<https_passphrase>    Passphrase for the TLS key or keystore                                                                                                              
        --https.validityDays=<https_validity_days>    Validity in days for a generated self-signed certificate                                                                                            
                   --https.domains=<https_domains>    Comma-separated domains for a generated certificate                                                                                                 
                               --profile=<verbose>    Profile performance. Use --profile for CPU only, --profile=verbose for full report.                                                                 
                              --sslCert=<ssl_cert>    (DEPRECATED) Use \`--https.cert\` instead.                                                                                                            
                                --sslKey=<ssl_key>    (DEPRECATED) Use \`--https.key\` instead.                                                                                                             
      "
    `)
  })

  it('nuxt devtools', async () => {
    expect(await usage(commands.devtools, main)).toMatchInlineSnapshot(`
      "Enable or disable devtools in a Nuxt project (nuxt devtools v0.0.0)

      USAGE nuxt devtools [OPTIONS] <COMMAND> [ROOTDIR]

      ARGUMENTS

        COMMAND=<enable|disable>    Command to run (Required)                   
                         ROOTDIR    Specifies the working directory (Default: .)

      OPTIONS

        --cwd=<directory>    Specify the working directory, this takes precedence over ROOTDIR
      "
    `)
  })

  it('nuxt generate', async () => {
    expect(await usage(commands.generate, main)).toMatchInlineSnapshot(`
      "Build Nuxt and prerender all routes (nuxt generate v0.0.0)

      USAGE nuxt generate [OPTIONS] [ROOTDIR]

      ARGUMENTS

        ROOTDIR    Specifies the working directory (Default: .)

      OPTIONS

                       --cwd=<directory>    Specify the working directory, this takes precedence over ROOTDIR                                                                                   
        --logLevel=<silent|info|verbose>    Specify build-time log level                                                                                                                        
                       --preset=<preset>    Nitro server preset                                                                                                                                 
                       --dotenv=<dotenv>    Path to \`.env\` file to load, relative to the root directory                                                                                         
                    --envName=<env_name>    The environment to use when resolving configuration overrides (default is \`production\` when building, and \`development\` when running the dev server)
              -e, --extends=<layer-name>    Extend from a Nuxt layer                                                                                                                            
                     --profile=<verbose>    Profile performance. Use --profile for CPU only, --profile=verbose for full report.                                                                 
      "
    `)
  })

  it('nuxt info', async () => {
    expect(await usage(commands.info, main)).toMatchInlineSnapshot(`
      "Get information about Nuxt project (nuxt info v0.0.0)

      USAGE nuxt info [OPTIONS] [ROOTDIR]

      ARGUMENTS

        ROOTDIR    Specifies the working directory (Default: .)

      OPTIONS

        --cwd=<directory>    Specify the working directory, this takes precedence over ROOTDIR
      "
    `)
  })

  it('nuxt init', async () => {
    expect(await usage(commands.init, main)).toMatchInlineSnapshot(`
      "Initialize a fresh project (nuxt init v0.0.0)

      USAGE nuxt init [OPTIONS] [DIR]

      ARGUMENTS

        DIR    Project directory (Default: )

      OPTIONS

                         --cwd=<directory>    Specify the working directory (Default: .)                    
          --logLevel=<silent|info|verbose>    Specify build-time log level                                  
                 -t, --template=<template>    Template name                                                 
                               -f, --force    Override existing directory                                   
                                 --offline    Force offline mode                                            
                           --preferOffline    Prefer offline mode                                           
                                 --install    Skip installing dependencies (Default: true)                  
                              --no-install                                                                  
                                 --gitInit    Initialize git repository                                     
                                   --shell    Start shell after installation in project directory           
        --packageManager=<package_manager>    Package manager choice (npm, pnpm, yarn, bun, deno, aube, nub)
                   -M, --modules=<modules>    Nuxt modules to install (comma separated without spaces)      
                       --nightly=<nightly>    Use Nuxt nightly release channel (3x or latest)               
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

        ROOTDIR    Specifies the working directory (Default: .)

      OPTIONS

                       --dotenv=<dotenv>    Path to \`.env\` file to load, relative to the root directory                                                                                         
                       --cwd=<directory>    Specify the working directory, this takes precedence over ROOTDIR                                                                                   
        --logLevel=<silent|info|verbose>    Specify build-time log level                                                                                                                        
                    --envName=<env_name>    The environment to use when resolving configuration overrides (default is \`production\` when building, and \`development\` when running the dev server)
              -e, --extends=<layer-name>    Extend from a Nuxt layer                                                                                                                            
      "
    `)
  })

  it('nuxt preview', async () => {
    expect(await usage(commands.preview, main)).toMatchInlineSnapshot(`
      "Launches Nitro server for local testing after \`nuxt build\`. (nuxt preview v0.0.0)

      USAGE nuxt preview [OPTIONS] [ROOTDIR]

      ARGUMENTS

        ROOTDIR    Specifies the working directory (Default: .)

      OPTIONS

                       --cwd=<directory>    Specify the working directory, this takes precedence over ROOTDIR                                                                                   
        --logLevel=<silent|info|verbose>    Specify build-time log level                                                                                                                        
                    --envName=<env_name>    The environment to use when resolving configuration overrides (default is \`production\` when building, and \`development\` when running the dev server)
              -e, --extends=<layer-name>    Extend from a Nuxt layer                                                                                                                            
                       -p, --port=<port>    Port to listen on                                                                                                                                   
                       --dotenv=<dotenv>    Path to \`.env\` file to load, relative to the root directory                                                                                         
      "
    `)
  })

  it('nuxt start', async () => {
    expect(await usage(commands.start, main)).toMatchInlineSnapshot(`
      "Launches Nitro server for local testing after \`nuxt build\`. (nuxt preview v0.0.0)

      USAGE nuxt preview [OPTIONS] [ROOTDIR]

      ARGUMENTS

        ROOTDIR    Specifies the working directory (Default: .)

      OPTIONS

                       --cwd=<directory>    Specify the working directory, this takes precedence over ROOTDIR                                                                                   
        --logLevel=<silent|info|verbose>    Specify build-time log level                                                                                                                        
                    --envName=<env_name>    The environment to use when resolving configuration overrides (default is \`production\` when building, and \`development\` when running the dev server)
              -e, --extends=<layer-name>    Extend from a Nuxt layer                                                                                                                            
                       -p, --port=<port>    Port to listen on                                                                                                                                   
                       --dotenv=<dotenv>    Path to \`.env\` file to load, relative to the root directory                                                                                         
      "
    `)
  })

  it('nuxt test', async () => {
    expect(await usage(commands.test, main)).toMatchInlineSnapshot(`
      "Run tests (nuxt test v0.0.0)

      USAGE nuxt test [OPTIONS] [ROOTDIR]

      ARGUMENTS

        ROOTDIR    Specifies the working directory (Default: .)

      OPTIONS

                       --cwd=<directory>    Specify the working directory, this takes precedence over ROOTDIR
        --logLevel=<silent|info|verbose>    Specify build-time log level                                     
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

        ROOTDIR    Specifies the working directory (Default: .)

      OPTIONS

                       --cwd=<directory>    Specify the working directory, this takes precedence over ROOTDIR
        --logLevel=<silent|info|verbose>    Specify build-time log level                                     
                       --dotenv=<dotenv>    Path to \`.env\` file to load, relative to the root directory      
              -e, --extends=<layer-name>    Extend from a Nuxt layer                                         
                     --checker=<checker>    Type checker to use (\`vue-tsc\` or \`golar\`)                       
      "
    `)
  })

  it('nuxt upgrade', async () => {
    expect(await usage(commands.upgrade, main)).toMatchInlineSnapshot(`
      "Upgrade Nuxt (nuxt upgrade v0.0.0)

      USAGE nuxt upgrade [OPTIONS] [ROOTDIR]

      ARGUMENTS

        ROOTDIR    Specifies the working directory (Default: .)

      OPTIONS

                                                  --cwd=<directory>    Specify the working directory, this takes precedence over ROOTDIR
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

      USAGE module add [OPTIONS] <MODULENAME>

      ARGUMENTS

        MODULENAME    Specify one or more modules to install by name, separated by spaces (Required)

      OPTIONS

                         --cwd=<directory>    Specify the working directory (Default: .)                             
          --logLevel=<silent|info|verbose>    Specify build-time log level                                           
                             --skipInstall    Skip npm install                                                       
                              --skipConfig    Skip nuxt.config.ts update                                             
                                     --dev    Install modules as dev dependencies                                    
        --packageManager=<package_manager>    Package manager to install with (npm, aube, nub, pnpm, bun, yarn, deno)
      "
    `)
  })

  it('nuxt module remove', async () => {
    expect(await usage(await subCommand(commands.module, 'remove'), commands.module)).toMatchInlineSnapshot(`
      "Remove Nuxt modules (module remove)

      USAGE module remove [OPTIONS] [MODULENAME]

      ARGUMENTS

        MODULENAME    Specify one or more modules to remove by name, separated by spaces

      OPTIONS

                       --cwd=<directory>    Specify the working directory (Default: .)
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

          --cwd=<directory>    Specify the working directory (Default: .)                                        
        --nuxtVersion=<2|3>    Filter by Nuxt version and list compatible modules only (auto detected by default)
      "
    `)
  })
})
