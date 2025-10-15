2025-10-13T00:17:56.2101232Z Current runner version: '2.328.0'
2025-10-13T00:17:56.2137325Z ##[group]Runner Image Provisioner
2025-10-13T00:17:56.2138627Z Hosted Compute Agent
2025-10-13T00:17:56.2139772Z Version: 20250912.392
2025-10-13T00:17:56.2140876Z Commit: d921fda672a98b64f4f82364647e2f10b2267d0b
2025-10-13T00:17:56.2142202Z Build Date: 2025-09-12T15:23:14Z
2025-10-13T00:17:56.2143327Z ##[endgroup]
2025-10-13T00:17:56.2144542Z ##[group]Operating System
2025-10-13T00:17:56.2145626Z Ubuntu
2025-10-13T00:17:56.2146402Z 24.04.3
2025-10-13T00:17:56.2147153Z LTS
2025-10-13T00:17:56.2147944Z ##[endgroup]
2025-10-13T00:17:56.2148778Z ##[group]Runner Image
2025-10-13T00:17:56.2149722Z Image: ubuntu-24.04
2025-10-13T00:17:56.2150591Z Version: 20250929.60.1
2025-10-13T00:17:56.2152368Z Included Software: https://github.com/actions/runner-images/blob/ubuntu24/20250929.60/images/ubuntu/Ubuntu2404-Readme.md
2025-10-13T00:17:56.2155536Z Image Release: https://github.com/actions/runner-images/releases/tag/ubuntu24%2F20250929.60
2025-10-13T00:17:56.2157258Z ##[endgroup]
2025-10-13T00:17:56.2159251Z ##[group]GITHUB_TOKEN Permissions
2025-10-13T00:17:56.2161939Z Contents: read
2025-10-13T00:17:56.2162986Z Metadata: read
2025-10-13T00:17:56.2163799Z Packages: read
2025-10-13T00:17:56.2164976Z ##[endgroup]
2025-10-13T00:17:56.2168802Z Secret source: Actions
2025-10-13T00:17:56.2170099Z Prepare workflow directory
2025-10-13T00:17:56.2670893Z Prepare all required actions
2025-10-13T00:17:56.2730982Z Getting action download info
2025-10-13T00:17:56.4976087Z Download action repository 'actions/checkout@v4' (SHA:08eba0b27e820071cde6df949e0beb9ba4906955)
2025-10-13T00:17:56.7041406Z Download action repository 'actions/setup-node@v4' (SHA:49933ea5288caeca8642d1e84afbd3f7d6820020)
2025-10-13T00:17:56.8820736Z Complete job name: lint
2025-10-13T00:17:56.9513601Z ##[group]Run actions/checkout@v4
2025-10-13T00:17:56.9514916Z with:
2025-10-13T00:17:56.9515400Z   repository: 23Maestro/prospect-pipeline
2025-10-13T00:17:56.9516196Z   token: ***
2025-10-13T00:17:56.9516604Z   ssh-strict: true
2025-10-13T00:17:56.9516995Z   ssh-user: git
2025-10-13T00:17:56.9517389Z   persist-credentials: true
2025-10-13T00:17:56.9517829Z   clean: true
2025-10-13T00:17:56.9518229Z   sparse-checkout-cone-mode: true
2025-10-13T00:17:56.9518707Z   fetch-depth: 1
2025-10-13T00:17:56.9519087Z   fetch-tags: false
2025-10-13T00:17:56.9519490Z   show-progress: true
2025-10-13T00:17:56.9519879Z   lfs: false
2025-10-13T00:17:56.9520242Z   submodules: false
2025-10-13T00:17:56.9520645Z   set-safe-directory: true
2025-10-13T00:17:56.9521366Z ##[endgroup]
2025-10-13T00:17:57.0677905Z Syncing repository: 23Maestro/prospect-pipeline
2025-10-13T00:17:57.0679824Z ##[group]Getting Git version info
2025-10-13T00:17:57.0680722Z Working directory is '/home/runner/work/prospect-pipeline/prospect-pipeline'
2025-10-13T00:17:57.0681753Z [command]/usr/bin/git version
2025-10-13T00:17:57.0770131Z git version 2.51.0
2025-10-13T00:17:57.0799154Z ##[endgroup]
2025-10-13T00:17:57.0816737Z Temporarily overriding HOME='/home/runner/work/_temp/c9028c80-8e55-48ad-a4f1-a06eefc67dce' before making global git config changes
2025-10-13T00:17:57.0819096Z Adding repository directory to the temporary git global config as a safe directory
2025-10-13T00:17:57.0832567Z [command]/usr/bin/git config --global --add safe.directory /home/runner/work/prospect-pipeline/prospect-pipeline
2025-10-13T00:17:57.0873468Z Deleting the contents of '/home/runner/work/prospect-pipeline/prospect-pipeline'
2025-10-13T00:17:57.0878192Z ##[group]Initializing the repository
2025-10-13T00:17:57.0883151Z [command]/usr/bin/git init /home/runner/work/prospect-pipeline/prospect-pipeline
2025-10-13T00:17:57.0987712Z hint: Using 'master' as the name for the initial branch. This default branch name
2025-10-13T00:17:57.0989145Z hint: is subject to change. To configure the initial branch name to use in all
2025-10-13T00:17:57.0990558Z hint: of your new repositories, which will suppress this warning, call:
2025-10-13T00:17:57.0991252Z hint:
2025-10-13T00:17:57.0992048Z hint: 	git config --global init.defaultBranch <name>
2025-10-13T00:17:57.0993930Z hint:
2025-10-13T00:17:57.0995126Z hint: Names commonly chosen instead of 'master' are 'main', 'trunk' and
2025-10-13T00:17:57.0996658Z hint: 'development'. The just-created branch can be renamed via this command:
2025-10-13T00:17:57.0997869Z hint:
2025-10-13T00:17:57.0998558Z hint: 	git branch -m <name>
2025-10-13T00:17:57.0999292Z hint:
2025-10-13T00:17:57.1000245Z hint: Disable this message with "git config set advice.defaultBranchName false"
2025-10-13T00:17:57.1002036Z Initialized empty Git repository in /home/runner/work/prospect-pipeline/prospect-pipeline/.git/
2025-10-13T00:17:57.1006938Z [command]/usr/bin/git remote add origin https://github.com/23Maestro/prospect-pipeline
2025-10-13T00:17:57.1048884Z ##[endgroup]
2025-10-13T00:17:57.1050049Z ##[group]Disabling automatic garbage collection
2025-10-13T00:17:57.1053907Z [command]/usr/bin/git config --local gc.auto 0
2025-10-13T00:17:57.1086081Z ##[endgroup]
2025-10-13T00:17:57.1087315Z ##[group]Setting up auth
2025-10-13T00:17:57.1094557Z [command]/usr/bin/git config --local --name-only --get-regexp core\.sshCommand
2025-10-13T00:17:57.1127780Z [command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'core\.sshCommand' && git config --local --unset-all 'core.sshCommand' || :"
2025-10-13T00:17:57.1473588Z [command]/usr/bin/git config --local --name-only --get-regexp http\.https\:\/\/github\.com\/\.extraheader
2025-10-13T00:17:57.1505686Z [command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'http\.https\:\/\/github\.com\/\.extraheader' && git config --local --unset-all 'http.https://github.com/.extraheader' || :"
2025-10-13T00:17:57.1750519Z [command]/usr/bin/git config --local http.https://github.com/.extraheader AUTHORIZATION: basic ***
2025-10-13T00:17:57.1796578Z ##[endgroup]
2025-10-13T00:17:57.1797320Z ##[group]Fetching the repository
2025-10-13T00:17:57.1805635Z [command]/usr/bin/git -c protocol.version=2 fetch --no-tags --prune --no-recurse-submodules --depth=1 origin +7087c62eb3c8d57cd8007369314dd73839c99bf7:refs/remotes/origin/main
2025-10-13T00:17:57.4281667Z From https://github.com/23Maestro/prospect-pipeline
2025-10-13T00:17:57.4282949Z  * [new ref]         7087c62eb3c8d57cd8007369314dd73839c99bf7 -> origin/main
2025-10-13T00:17:57.4314089Z ##[endgroup]
2025-10-13T00:17:57.4315201Z ##[group]Determining the checkout info
2025-10-13T00:17:57.4316611Z ##[endgroup]
2025-10-13T00:17:57.4321650Z [command]/usr/bin/git sparse-checkout disable
2025-10-13T00:17:57.4363070Z [command]/usr/bin/git config --local --unset-all extensions.worktreeConfig
2025-10-13T00:17:57.4392171Z ##[group]Checking out the ref
2025-10-13T00:17:57.4396101Z [command]/usr/bin/git checkout --progress --force -B main refs/remotes/origin/main
2025-10-13T00:17:57.4602556Z Switched to a new branch 'main'
2025-10-13T00:17:57.4603349Z branch 'main' set up to track 'origin/main'.
2025-10-13T00:17:57.4611693Z ##[endgroup]
2025-10-13T00:17:57.4654933Z [command]/usr/bin/git log -1 --format=%H
2025-10-13T00:17:57.4677721Z 7087c62eb3c8d57cd8007369314dd73839c99bf7
2025-10-13T00:17:57.4922297Z ##[group]Run actions/setup-node@v4
2025-10-13T00:17:57.4922822Z with:
2025-10-13T00:17:57.4923170Z   node-version: 18
2025-10-13T00:17:57.4923537Z   cache: npm
2025-10-13T00:17:57.4923902Z   always-auth: false
2025-10-13T00:17:57.4924619Z   check-latest: false
2025-10-13T00:17:57.4925176Z   token: ***
2025-10-13T00:17:57.4925531Z ##[endgroup]
2025-10-13T00:17:57.6827151Z Found in cache @ /opt/hostedtoolcache/node/18.20.8/x64
2025-10-13T00:17:57.6828982Z ##[group]Environment details
2025-10-13T00:17:59.9073660Z node: v18.20.8
2025-10-13T00:17:59.9074617Z npm: 10.8.2
2025-10-13T00:17:59.9074997Z yarn: 1.22.22
2025-10-13T00:17:59.9075950Z ##[endgroup]
2025-10-13T00:17:59.9094859Z [command]/opt/hostedtoolcache/node/18.20.8/x64/bin/npm config get cache
2025-10-13T00:18:00.2251110Z /home/runner/.npm
2025-10-13T00:18:00.3760884Z npm cache is not found
2025-10-13T00:18:00.3880744Z ##[group]Run npm ci
2025-10-13T00:18:00.3881135Z [36;1mnpm ci[0m
2025-10-13T00:18:00.4005476Z shell: /usr/bin/bash -e {0}
2025-10-13T00:18:00.4005855Z ##[endgroup]
2025-10-13T00:18:04.0555741Z npm warn EBADENGINE Unsupported engine {
2025-10-13T00:18:04.0556803Z npm warn EBADENGINE   package: '@raycast/api@1.102.7',
2025-10-13T00:18:04.0557767Z npm warn EBADENGINE   required: { node: '>=22.14.0' },
2025-10-13T00:18:04.0558790Z npm warn EBADENGINE   current: { node: 'v18.20.8', npm: '10.8.2' }
2025-10-13T00:18:04.0559502Z npm warn EBADENGINE }
2025-10-13T00:18:08.5265834Z 
2025-10-13T00:18:08.5266504Z added 241 packages, and audited 242 packages in 8s
2025-10-13T00:18:08.5266860Z 
2025-10-13T00:18:08.5267060Z 58 packages are looking for funding
2025-10-13T00:18:08.5267436Z   run `npm fund` for details
2025-10-13T00:18:08.5275873Z 
2025-10-13T00:18:08.5276105Z found 0 vulnerabilities
2025-10-13T00:18:08.5523642Z ##[group]Run npx eslint src/**/*.{ts,tsx} raycast-env.d.ts --max-warnings 0
2025-10-13T00:18:08.5528377Z [36;1mnpx eslint src/**/*.{ts,tsx} raycast-env.d.ts --max-warnings 0[0m
2025-10-13T00:18:08.5565930Z shell: /usr/bin/bash -e {0}
2025-10-13T00:18:08.5566196Z ##[endgroup]
2025-10-13T00:18:09.2086222Z 
2025-10-13T00:18:09.2086976Z Oops! Something went wrong! :(
2025-10-13T00:18:09.2087420Z 
2025-10-13T00:18:09.2088182Z ESLint: 9.37.0
2025-10-13T00:18:09.2088525Z 
2025-10-13T00:18:09.2088960Z No files matching the pattern "raycast-env.d.ts" were found.
2025-10-13T00:18:09.2089901Z Please check for typing mistakes in the pattern.
2025-10-13T00:18:09.2090306Z 
2025-10-13T00:18:09.9193337Z ##[error]Process completed with exit code 2.
2025-10-13T00:18:09.9363009Z Post job cleanup.
2025-10-13T00:18:10.0366349Z [command]/usr/bin/git version
2025-10-13T00:18:10.0405482Z git version 2.51.0
2025-10-13T00:18:10.0452999Z Temporarily overriding HOME='/home/runner/work/_temp/580324ab-eee2-413e-9438-bc19ad75af14' before making global git config changes
2025-10-13T00:18:10.0454042Z Adding repository directory to the temporary git global config as a safe directory
2025-10-13T00:18:10.0462202Z [command]/usr/bin/git config --global --add safe.directory /home/runner/work/prospect-pipeline/prospect-pipeline
2025-10-13T00:18:10.0506978Z [command]/usr/bin/git config --local --name-only --get-regexp core\.sshCommand
2025-10-13T00:18:10.0544075Z [command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'core\.sshCommand' && git config --local --unset-all 'core.sshCommand' || :"
2025-10-13T00:18:10.0792071Z [command]/usr/bin/git config --local --name-only --get-regexp http\.https\:\/\/github\.com\/\.extraheader
2025-10-13T00:18:10.0816912Z http.https://github.com/.extraheader
2025-10-13T00:18:10.0830765Z [command]/usr/bin/git config --local --unset-all http.https://github.com/.extraheader
2025-10-13T00:18:10.0864888Z [command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'http\.https\:\/\/github\.com\/\.extraheader' && git config --local --unset-all 'http.https://github.com/.extraheader' || :"
2025-10-13T00:18:10.1218296Z Cleaning up orphan processes
