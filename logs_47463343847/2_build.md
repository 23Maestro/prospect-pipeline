2025-10-13T00:17:57.5463428Z Current runner version: '2.328.0'
2025-10-13T00:17:57.5488176Z ##[group]Runner Image Provisioner
2025-10-13T00:17:57.5488985Z Hosted Compute Agent
2025-10-13T00:17:57.5489806Z Version: 20250912.392
2025-10-13T00:17:57.5490531Z Commit: d921fda672a98b64f4f82364647e2f10b2267d0b
2025-10-13T00:17:57.5491178Z Build Date: 2025-09-12T15:23:14Z
2025-10-13T00:17:57.5491817Z ##[endgroup]
2025-10-13T00:17:57.5492360Z ##[group]Operating System
2025-10-13T00:17:57.5492919Z Ubuntu
2025-10-13T00:17:57.5493341Z 24.04.3
2025-10-13T00:17:57.5493873Z LTS
2025-10-13T00:17:57.5494292Z ##[endgroup]
2025-10-13T00:17:57.5494767Z ##[group]Runner Image
2025-10-13T00:17:57.5495412Z Image: ubuntu-24.04
2025-10-13T00:17:57.5495890Z Version: 20250929.60.1
2025-10-13T00:17:57.5496868Z Included Software: https://github.com/actions/runner-images/blob/ubuntu24/20250929.60/images/ubuntu/Ubuntu2404-Readme.md
2025-10-13T00:17:57.5498421Z Image Release: https://github.com/actions/runner-images/releases/tag/ubuntu24%2F20250929.60
2025-10-13T00:17:57.5499457Z ##[endgroup]
2025-10-13T00:17:57.5500671Z ##[group]GITHUB_TOKEN Permissions
2025-10-13T00:17:57.5502476Z Contents: read
2025-10-13T00:17:57.5503125Z Metadata: read
2025-10-13T00:17:57.5503584Z Packages: read
2025-10-13T00:17:57.5504071Z ##[endgroup]
2025-10-13T00:17:57.5506134Z Secret source: Actions
2025-10-13T00:17:57.5506888Z Prepare workflow directory
2025-10-13T00:17:57.5844305Z Prepare all required actions
2025-10-13T00:17:57.5883830Z Getting action download info
2025-10-13T00:17:57.9424386Z Download action repository 'actions/checkout@v4' (SHA:08eba0b27e820071cde6df949e0beb9ba4906955)
2025-10-13T00:17:58.1567462Z Download action repository 'actions/setup-node@v4' (SHA:49933ea5288caeca8642d1e84afbd3f7d6820020)
2025-10-13T00:17:58.3811542Z Complete job name: build
2025-10-13T00:17:58.4469239Z ##[group]Run actions/checkout@v4
2025-10-13T00:17:58.4470500Z with:
2025-10-13T00:17:58.4470954Z   repository: 23Maestro/prospect-pipeline
2025-10-13T00:17:58.4471652Z   token: ***
2025-10-13T00:17:58.4472056Z   ssh-strict: true
2025-10-13T00:17:58.4472443Z   ssh-user: git
2025-10-13T00:17:58.4472850Z   persist-credentials: true
2025-10-13T00:17:58.4473288Z   clean: true
2025-10-13T00:17:58.4473686Z   sparse-checkout-cone-mode: true
2025-10-13T00:17:58.4474154Z   fetch-depth: 1
2025-10-13T00:17:58.4474539Z   fetch-tags: false
2025-10-13T00:17:58.4474927Z   show-progress: true
2025-10-13T00:17:58.4475339Z   lfs: false
2025-10-13T00:17:58.4475703Z   submodules: false
2025-10-13T00:17:58.4476105Z   set-safe-directory: true
2025-10-13T00:17:58.4476767Z ##[endgroup]
2025-10-13T00:17:58.5553673Z Syncing repository: 23Maestro/prospect-pipeline
2025-10-13T00:17:58.5555518Z ##[group]Getting Git version info
2025-10-13T00:17:58.5556363Z Working directory is '/home/runner/work/prospect-pipeline/prospect-pipeline'
2025-10-13T00:17:58.5557385Z [command]/usr/bin/git version
2025-10-13T00:17:58.5645941Z git version 2.51.0
2025-10-13T00:17:58.5672322Z ##[endgroup]
2025-10-13T00:17:58.5694126Z Temporarily overriding HOME='/home/runner/work/_temp/ead7c564-d6ad-4065-b01d-74d0be7b181d' before making global git config changes
2025-10-13T00:17:58.5695499Z Adding repository directory to the temporary git global config as a safe directory
2025-10-13T00:17:58.5699457Z [command]/usr/bin/git config --global --add safe.directory /home/runner/work/prospect-pipeline/prospect-pipeline
2025-10-13T00:17:58.5736748Z Deleting the contents of '/home/runner/work/prospect-pipeline/prospect-pipeline'
2025-10-13T00:17:58.5740278Z ##[group]Initializing the repository
2025-10-13T00:17:58.5744413Z [command]/usr/bin/git init /home/runner/work/prospect-pipeline/prospect-pipeline
2025-10-13T00:17:58.5915157Z hint: Using 'master' as the name for the initial branch. This default branch name
2025-10-13T00:17:58.5916948Z hint: is subject to change. To configure the initial branch name to use in all
2025-10-13T00:17:58.5917939Z hint: of your new repositories, which will suppress this warning, call:
2025-10-13T00:17:58.5918858Z hint:
2025-10-13T00:17:58.5919956Z hint: 	git config --global init.defaultBranch <name>
2025-10-13T00:17:58.5921340Z hint:
2025-10-13T00:17:58.5922347Z hint: Names commonly chosen instead of 'master' are 'main', 'trunk' and
2025-10-13T00:17:58.5923957Z hint: 'development'. The just-created branch can be renamed via this command:
2025-10-13T00:17:58.5925180Z hint:
2025-10-13T00:17:58.5925874Z hint: 	git branch -m <name>
2025-10-13T00:17:58.5926629Z hint:
2025-10-13T00:17:58.5927827Z hint: Disable this message with "git config set advice.defaultBranchName false"
2025-10-13T00:17:58.5930037Z Initialized empty Git repository in /home/runner/work/prospect-pipeline/prospect-pipeline/.git/
2025-10-13T00:17:58.5936487Z [command]/usr/bin/git remote add origin https://github.com/23Maestro/prospect-pipeline
2025-10-13T00:17:58.5980977Z ##[endgroup]
2025-10-13T00:17:58.5982219Z ##[group]Disabling automatic garbage collection
2025-10-13T00:17:58.5986281Z [command]/usr/bin/git config --local gc.auto 0
2025-10-13T00:17:58.6018861Z ##[endgroup]
2025-10-13T00:17:58.6020356Z ##[group]Setting up auth
2025-10-13T00:17:58.6026498Z [command]/usr/bin/git config --local --name-only --get-regexp core\.sshCommand
2025-10-13T00:17:58.6059826Z [command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'core\.sshCommand' && git config --local --unset-all 'core.sshCommand' || :"
2025-10-13T00:17:58.6429899Z [command]/usr/bin/git config --local --name-only --get-regexp http\.https\:\/\/github\.com\/\.extraheader
2025-10-13T00:17:58.6459503Z [command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'http\.https\:\/\/github\.com\/\.extraheader' && git config --local --unset-all 'http.https://github.com/.extraheader' || :"
2025-10-13T00:17:58.6679366Z [command]/usr/bin/git config --local http.https://github.com/.extraheader AUTHORIZATION: basic ***
2025-10-13T00:17:58.6715452Z ##[endgroup]
2025-10-13T00:17:58.6716214Z ##[group]Fetching the repository
2025-10-13T00:17:58.6724251Z [command]/usr/bin/git -c protocol.version=2 fetch --no-tags --prune --no-recurse-submodules --depth=1 origin +7087c62eb3c8d57cd8007369314dd73839c99bf7:refs/remotes/origin/main
2025-10-13T00:17:59.2625084Z From https://github.com/23Maestro/prospect-pipeline
2025-10-13T00:17:59.2626750Z  * [new ref]         7087c62eb3c8d57cd8007369314dd73839c99bf7 -> origin/main
2025-10-13T00:17:59.2719970Z ##[endgroup]
2025-10-13T00:17:59.2721502Z ##[group]Determining the checkout info
2025-10-13T00:17:59.2723349Z ##[endgroup]
2025-10-13T00:17:59.2728332Z [command]/usr/bin/git sparse-checkout disable
2025-10-13T00:17:59.2773793Z [command]/usr/bin/git config --local --unset-all extensions.worktreeConfig
2025-10-13T00:17:59.2804887Z ##[group]Checking out the ref
2025-10-13T00:17:59.2809428Z [command]/usr/bin/git checkout --progress --force -B main refs/remotes/origin/main
2025-10-13T00:17:59.3020325Z Switched to a new branch 'main'
2025-10-13T00:17:59.3022930Z branch 'main' set up to track 'origin/main'.
2025-10-13T00:17:59.3031737Z ##[endgroup]
2025-10-13T00:17:59.3071626Z [command]/usr/bin/git log -1 --format=%H
2025-10-13T00:17:59.3096167Z 7087c62eb3c8d57cd8007369314dd73839c99bf7
2025-10-13T00:17:59.3393765Z ##[group]Run actions/setup-node@v4
2025-10-13T00:17:59.3394870Z with:
2025-10-13T00:17:59.3395651Z   node-version: 18
2025-10-13T00:17:59.3396490Z   cache: npm
2025-10-13T00:17:59.3397302Z   always-auth: false
2025-10-13T00:17:59.3398175Z   check-latest: false
2025-10-13T00:17:59.3399364Z   token: ***
2025-10-13T00:17:59.3400422Z ##[endgroup]
2025-10-13T00:17:59.5644116Z Found in cache @ /opt/hostedtoolcache/node/18.20.8/x64
2025-10-13T00:17:59.5650867Z ##[group]Environment details
2025-10-13T00:18:02.5637025Z node: v18.20.8
2025-10-13T00:18:02.5637813Z npm: 10.8.2
2025-10-13T00:18:02.5638144Z yarn: 1.22.22
2025-10-13T00:18:02.5639071Z ##[endgroup]
2025-10-13T00:18:02.5667250Z [command]/opt/hostedtoolcache/node/18.20.8/x64/bin/npm config get cache
2025-10-13T00:18:03.2703299Z /home/runner/.npm
2025-10-13T00:18:03.5633730Z npm cache is not found
2025-10-13T00:18:03.5758540Z ##[group]Run npm ci
2025-10-13T00:18:03.5758838Z [36;1mnpm ci[0m
2025-10-13T00:18:03.5906517Z shell: /usr/bin/bash -e {0}
2025-10-13T00:18:03.5906787Z ##[endgroup]
2025-10-13T00:18:08.7361452Z npm warn EBADENGINE Unsupported engine {
2025-10-13T00:18:08.7362103Z npm warn EBADENGINE   package: '@raycast/api@1.102.7',
2025-10-13T00:18:08.7362555Z npm warn EBADENGINE   required: { node: '>=22.14.0' },
2025-10-13T00:18:08.7363053Z npm warn EBADENGINE   current: { node: 'v18.20.8', npm: '10.8.2' }
2025-10-13T00:18:08.7363456Z npm warn EBADENGINE }
2025-10-13T00:18:13.2122555Z 
2025-10-13T00:18:13.2123270Z added 241 packages, and audited 242 packages in 10s
2025-10-13T00:18:13.2123751Z 
2025-10-13T00:18:13.2124005Z 58 packages are looking for funding
2025-10-13T00:18:13.2124492Z   run `npm fund` for details
2025-10-13T00:18:13.2136176Z 
2025-10-13T00:18:13.2136951Z found 0 vulnerabilities
2025-10-13T00:18:13.2405048Z ##[group]Run npm run build
2025-10-13T00:18:13.2405338Z [36;1mnpm run build[0m
2025-10-13T00:18:13.2439198Z shell: /usr/bin/bash -e {0}
2025-10-13T00:18:13.2439433Z ##[endgroup]
2025-10-13T00:18:13.4134008Z 
2025-10-13T00:18:13.4134433Z > build
2025-10-13T00:18:13.4134745Z > ray build
2025-10-13T00:18:13.4134933Z 
2025-10-13T00:18:13.9702877Z [36minfo[39m  - entry points ["src/active-tasks.tsx","src/assign-videoteam-inbox.tsx","src/read-videoteam-inbox.tsx","src/email-student-athletes.tsx","src/video-updates.tsx"]
2025-10-13T00:18:14.0563712Z     Error: Build failed with 2 errors:
2025-10-13T00:18:14.0564430Z     src/assign-videoteam-inbox.tsx:22:7: ERROR: Could not resolve 
2025-10-13T00:18:14.0564968Z     "./lib/npid-mcp-adapter"
2025-10-13T00:18:14.0565640Z     src/read-videoteam-inbox.tsx:14:34: ERROR: Could not resolve 
2025-10-13T00:18:14.0566244Z     "./lib/npid-mcp-adapter"
2025-10-13T00:18:14.0760219Z ##[error]Process completed with exit code 1.
2025-10-13T00:18:14.0926399Z Post job cleanup.
2025-10-13T00:18:14.1872979Z [command]/usr/bin/git version
2025-10-13T00:18:14.1913024Z git version 2.51.0
2025-10-13T00:18:14.1957336Z Temporarily overriding HOME='/home/runner/work/_temp/545deedc-20cd-401e-bf84-fd075519fa05' before making global git config changes
2025-10-13T00:18:14.1958830Z Adding repository directory to the temporary git global config as a safe directory
2025-10-13T00:18:14.1970968Z [command]/usr/bin/git config --global --add safe.directory /home/runner/work/prospect-pipeline/prospect-pipeline
2025-10-13T00:18:14.2006948Z [command]/usr/bin/git config --local --name-only --get-regexp core\.sshCommand
2025-10-13T00:18:14.2041686Z [command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'core\.sshCommand' && git config --local --unset-all 'core.sshCommand' || :"
2025-10-13T00:18:14.2281684Z [command]/usr/bin/git config --local --name-only --get-regexp http\.https\:\/\/github\.com\/\.extraheader
2025-10-13T00:18:14.2305525Z http.https://github.com/.extraheader
2025-10-13T00:18:14.2318096Z [command]/usr/bin/git config --local --unset-all http.https://github.com/.extraheader
2025-10-13T00:18:14.2351084Z [command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'http\.https\:\/\/github\.com\/\.extraheader' && git config --local --unset-all 'http.https://github.com/.extraheader' || :"
2025-10-13T00:18:14.2687596Z Cleaning up orphan processes
