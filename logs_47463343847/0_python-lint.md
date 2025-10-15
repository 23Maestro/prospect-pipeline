2025-10-13T00:17:56.2493776Z Current runner version: '2.328.0'
2025-10-13T00:17:56.2520624Z ##[group]Runner Image Provisioner
2025-10-13T00:17:56.2521870Z Hosted Compute Agent
2025-10-13T00:17:56.2522654Z Version: 20250912.392
2025-10-13T00:17:56.2523793Z Commit: d921fda672a98b64f4f82364647e2f10b2267d0b
2025-10-13T00:17:56.2524974Z Build Date: 2025-09-12T15:23:14Z
2025-10-13T00:17:56.2525944Z ##[endgroup]
2025-10-13T00:17:56.2526752Z ##[group]Operating System
2025-10-13T00:17:56.2527750Z Ubuntu
2025-10-13T00:17:56.2528523Z 24.04.3
2025-10-13T00:17:56.2529362Z LTS
2025-10-13T00:17:56.2530257Z ##[endgroup]
2025-10-13T00:17:56.2531074Z ##[group]Runner Image
2025-10-13T00:17:56.2532063Z Image: ubuntu-24.04
2025-10-13T00:17:56.2532869Z Version: 20250929.60.1
2025-10-13T00:17:56.2535031Z Included Software: https://github.com/actions/runner-images/blob/ubuntu24/20250929.60/images/ubuntu/Ubuntu2404-Readme.md
2025-10-13T00:17:56.2537568Z Image Release: https://github.com/actions/runner-images/releases/tag/ubuntu24%2F20250929.60
2025-10-13T00:17:56.2539228Z ##[endgroup]
2025-10-13T00:17:56.2541028Z ##[group]GITHUB_TOKEN Permissions
2025-10-13T00:17:56.2543810Z Contents: read
2025-10-13T00:17:56.2544729Z Metadata: read
2025-10-13T00:17:56.2545540Z Packages: read
2025-10-13T00:17:56.2546543Z ##[endgroup]
2025-10-13T00:17:56.2549827Z Secret source: Actions
2025-10-13T00:17:56.2550865Z Prepare workflow directory
2025-10-13T00:17:56.3000092Z Prepare all required actions
2025-10-13T00:17:56.3055931Z Getting action download info
2025-10-13T00:17:56.5873070Z Download action repository 'actions/checkout@v4' (SHA:08eba0b27e820071cde6df949e0beb9ba4906955)
2025-10-13T00:17:56.7911763Z Download action repository 'actions/setup-python@v4' (SHA:7f4fc3e22c37d6ff65e88745f38bd3157c663f7c)
2025-10-13T00:17:57.2832214Z Complete job name: python-lint
2025-10-13T00:17:57.3549100Z ##[group]Run actions/checkout@v4
2025-10-13T00:17:57.3550007Z with:
2025-10-13T00:17:57.3550471Z   repository: 23Maestro/prospect-pipeline
2025-10-13T00:17:57.3551208Z   token: ***
2025-10-13T00:17:57.3551641Z   ssh-strict: true
2025-10-13T00:17:57.3552047Z   ssh-user: git
2025-10-13T00:17:57.3552471Z   persist-credentials: true
2025-10-13T00:17:57.3552929Z   clean: true
2025-10-13T00:17:57.3554030Z   sparse-checkout-cone-mode: true
2025-10-13T00:17:57.3554612Z   fetch-depth: 1
2025-10-13T00:17:57.3555034Z   fetch-tags: false
2025-10-13T00:17:57.3555461Z   show-progress: true
2025-10-13T00:17:57.3555903Z   lfs: false
2025-10-13T00:17:57.3556314Z   submodules: false
2025-10-13T00:17:57.3556763Z   set-safe-directory: true
2025-10-13T00:17:57.3557613Z ##[endgroup]
2025-10-13T00:17:57.4650941Z Syncing repository: 23Maestro/prospect-pipeline
2025-10-13T00:17:57.4654269Z ##[group]Getting Git version info
2025-10-13T00:17:57.4655957Z Working directory is '/home/runner/work/prospect-pipeline/prospect-pipeline'
2025-10-13T00:17:57.4658134Z [command]/usr/bin/git version
2025-10-13T00:17:57.4724654Z git version 2.51.0
2025-10-13T00:17:57.4751662Z ##[endgroup]
2025-10-13T00:17:57.4767308Z Temporarily overriding HOME='/home/runner/work/_temp/af1644b0-6d88-47a7-8d13-d2ee276c4453' before making global git config changes
2025-10-13T00:17:57.4770021Z Adding repository directory to the temporary git global config as a safe directory
2025-10-13T00:17:57.4781192Z [command]/usr/bin/git config --global --add safe.directory /home/runner/work/prospect-pipeline/prospect-pipeline
2025-10-13T00:17:57.4819090Z Deleting the contents of '/home/runner/work/prospect-pipeline/prospect-pipeline'
2025-10-13T00:17:57.4822548Z ##[group]Initializing the repository
2025-10-13T00:17:57.4827942Z [command]/usr/bin/git init /home/runner/work/prospect-pipeline/prospect-pipeline
2025-10-13T00:17:57.4932814Z hint: Using 'master' as the name for the initial branch. This default branch name
2025-10-13T00:17:57.4934736Z hint: is subject to change. To configure the initial branch name to use in all
2025-10-13T00:17:57.4936482Z hint: of your new repositories, which will suppress this warning, call:
2025-10-13T00:17:57.4937699Z hint:
2025-10-13T00:17:57.4938862Z hint: 	git config --global init.defaultBranch <name>
2025-10-13T00:17:57.4939544Z hint:
2025-10-13T00:17:57.4940154Z hint: Names commonly chosen instead of 'master' are 'main', 'trunk' and
2025-10-13T00:17:57.4941082Z hint: 'development'. The just-created branch can be renamed via this command:
2025-10-13T00:17:57.4941836Z hint:
2025-10-13T00:17:57.4942248Z hint: 	git branch -m <name>
2025-10-13T00:17:57.4942717Z hint:
2025-10-13T00:17:57.4943936Z hint: Disable this message with "git config set advice.defaultBranchName false"
2025-10-13T00:17:57.4945219Z Initialized empty Git repository in /home/runner/work/prospect-pipeline/prospect-pipeline/.git/
2025-10-13T00:17:57.4949051Z [command]/usr/bin/git remote add origin https://github.com/23Maestro/prospect-pipeline
2025-10-13T00:17:57.4985983Z ##[endgroup]
2025-10-13T00:17:57.4986795Z ##[group]Disabling automatic garbage collection
2025-10-13T00:17:57.4989771Z [command]/usr/bin/git config --local gc.auto 0
2025-10-13T00:17:57.5017368Z ##[endgroup]
2025-10-13T00:17:57.5018115Z ##[group]Setting up auth
2025-10-13T00:17:57.5024469Z [command]/usr/bin/git config --local --name-only --get-regexp core\.sshCommand
2025-10-13T00:17:57.5052432Z [command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'core\.sshCommand' && git config --local --unset-all 'core.sshCommand' || :"
2025-10-13T00:17:57.5405424Z [command]/usr/bin/git config --local --name-only --get-regexp http\.https\:\/\/github\.com\/\.extraheader
2025-10-13T00:17:57.5437520Z [command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'http\.https\:\/\/github\.com\/\.extraheader' && git config --local --unset-all 'http.https://github.com/.extraheader' || :"
2025-10-13T00:17:57.5657576Z [command]/usr/bin/git config --local http.https://github.com/.extraheader AUTHORIZATION: basic ***
2025-10-13T00:17:57.5691456Z ##[endgroup]
2025-10-13T00:17:57.5693523Z ##[group]Fetching the repository
2025-10-13T00:17:57.5709782Z [command]/usr/bin/git -c protocol.version=2 fetch --no-tags --prune --no-recurse-submodules --depth=1 origin +7087c62eb3c8d57cd8007369314dd73839c99bf7:refs/remotes/origin/main
2025-10-13T00:17:57.9294107Z From https://github.com/23Maestro/prospect-pipeline
2025-10-13T00:17:57.9295091Z  * [new ref]         7087c62eb3c8d57cd8007369314dd73839c99bf7 -> origin/main
2025-10-13T00:17:57.9325869Z ##[endgroup]
2025-10-13T00:17:57.9326623Z ##[group]Determining the checkout info
2025-10-13T00:17:57.9328099Z ##[endgroup]
2025-10-13T00:17:57.9333511Z [command]/usr/bin/git sparse-checkout disable
2025-10-13T00:17:57.9373043Z [command]/usr/bin/git config --local --unset-all extensions.worktreeConfig
2025-10-13T00:17:57.9401694Z ##[group]Checking out the ref
2025-10-13T00:17:57.9406189Z [command]/usr/bin/git checkout --progress --force -B main refs/remotes/origin/main
2025-10-13T00:17:57.9609859Z Switched to a new branch 'main'
2025-10-13T00:17:57.9611313Z branch 'main' set up to track 'origin/main'.
2025-10-13T00:17:57.9619651Z ##[endgroup]
2025-10-13T00:17:57.9656753Z [command]/usr/bin/git log -1 --format=%H
2025-10-13T00:17:57.9679188Z 7087c62eb3c8d57cd8007369314dd73839c99bf7
2025-10-13T00:17:57.9927076Z ##[group]Run actions/setup-python@v4
2025-10-13T00:17:57.9927710Z with:
2025-10-13T00:17:57.9928159Z   python-version: 3.11
2025-10-13T00:17:57.9928664Z   check-latest: false
2025-10-13T00:17:57.9929311Z   token: ***
2025-10-13T00:17:57.9929792Z   update-environment: true
2025-10-13T00:17:57.9930333Z   allow-prereleases: false
2025-10-13T00:17:57.9930838Z ##[endgroup]
2025-10-13T00:17:58.1616733Z ##[group]Installed versions
2025-10-13T00:17:58.2349267Z Successfully set up CPython (3.11.13)
2025-10-13T00:17:58.2350892Z ##[endgroup]
2025-10-13T00:17:58.2476127Z ##[group]Run cd mcp-servers/npid-native
2025-10-13T00:17:58.2476884Z [36;1mcd mcp-servers/npid-native[0m
2025-10-13T00:17:58.2477496Z [36;1mpip install -r requirements.txt[0m
2025-10-13T00:17:58.2478098Z [36;1mpip install flake8 black[0m
2025-10-13T00:17:58.2663433Z shell: /usr/bin/bash -e {0}
2025-10-13T00:17:58.2664230Z env:
2025-10-13T00:17:58.2664798Z   pythonLocation: /opt/hostedtoolcache/Python/3.11.13/x64
2025-10-13T00:17:58.2665670Z   PKG_CONFIG_PATH: /opt/hostedtoolcache/Python/3.11.13/x64/lib/pkgconfig
2025-10-13T00:17:58.2666502Z   Python_ROOT_DIR: /opt/hostedtoolcache/Python/3.11.13/x64
2025-10-13T00:17:58.2667257Z   Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.11.13/x64
2025-10-13T00:17:58.2668009Z   Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.11.13/x64
2025-10-13T00:17:58.2668770Z   LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.11.13/x64/lib
2025-10-13T00:17:58.2669426Z ##[endgroup]
2025-10-13T00:18:02.9482624Z Collecting requests>=2.31.0 (from -r requirements.txt (line 2))
2025-10-13T00:18:02.9828701Z   Downloading requests-2.32.5-py3-none-any.whl.metadata (4.9 kB)
2025-10-13T00:18:03.0038640Z Collecting beautifulsoup4>=4.12.0 (from -r requirements.txt (line 3))
2025-10-13T00:18:03.0077550Z   Downloading beautifulsoup4-4.14.2-py3-none-any.whl.metadata (3.8 kB)
2025-10-13T00:18:03.2119642Z Collecting lxml>=4.9.0 (from -r requirements.txt (line 4))
2025-10-13T00:18:03.2171235Z   Downloading lxml-6.0.2-cp311-cp311-manylinux_2_26_x86_64.manylinux_2_28_x86_64.whl.metadata (3.6 kB)
2025-10-13T00:18:03.2429717Z Collecting mcp>=1.9.4 (from -r requirements.txt (line 7))
2025-10-13T00:18:03.2598055Z   Downloading mcp-1.17.0-py3-none-any.whl.metadata (80 kB)
2025-10-13T00:18:03.3512017Z Collecting charset_normalizer<4,>=2 (from requests>=2.31.0->-r requirements.txt (line 2))
2025-10-13T00:18:03.3555109Z   Downloading charset_normalizer-3.4.3-cp311-cp311-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl.metadata (36 kB)
2025-10-13T00:18:03.3760499Z Collecting idna<4,>=2.5 (from requests>=2.31.0->-r requirements.txt (line 2))
2025-10-13T00:18:03.3799219Z   Downloading idna-3.11-py3-none-any.whl.metadata (8.4 kB)
2025-10-13T00:18:03.4081272Z Collecting urllib3<3,>=1.21.1 (from requests>=2.31.0->-r requirements.txt (line 2))
2025-10-13T00:18:03.4119759Z   Downloading urllib3-2.5.0-py3-none-any.whl.metadata (6.5 kB)
2025-10-13T00:18:03.4338649Z Collecting certifi>=2017.4.17 (from requests>=2.31.0->-r requirements.txt (line 2))
2025-10-13T00:18:03.4377746Z   Downloading certifi-2025.10.5-py3-none-any.whl.metadata (2.5 kB)
2025-10-13T00:18:03.4594515Z Collecting soupsieve>1.2 (from beautifulsoup4>=4.12.0->-r requirements.txt (line 3))
2025-10-13T00:18:03.4632601Z   Downloading soupsieve-2.8-py3-none-any.whl.metadata (4.6 kB)
2025-10-13T00:18:03.4931523Z Collecting typing-extensions>=4.0.0 (from beautifulsoup4>=4.12.0->-r requirements.txt (line 3))
2025-10-13T00:18:03.4971532Z   Downloading typing_extensions-4.15.0-py3-none-any.whl.metadata (3.3 kB)
2025-10-13T00:18:03.5174628Z Collecting anyio>=4.5 (from mcp>=1.9.4->-r requirements.txt (line 7))
2025-10-13T00:18:03.5210959Z   Downloading anyio-4.11.0-py3-none-any.whl.metadata (4.1 kB)
2025-10-13T00:18:03.5336210Z Collecting httpx-sse>=0.4 (from mcp>=1.9.4->-r requirements.txt (line 7))
2025-10-13T00:18:03.5371949Z   Downloading httpx_sse-0.4.3-py3-none-any.whl.metadata (9.7 kB)
2025-10-13T00:18:03.5564895Z Collecting httpx>=0.27.1 (from mcp>=1.9.4->-r requirements.txt (line 7))
2025-10-13T00:18:03.5602302Z   Downloading httpx-0.28.1-py3-none-any.whl.metadata (7.1 kB)
2025-10-13T00:18:03.5890520Z Collecting jsonschema>=4.20.0 (from mcp>=1.9.4->-r requirements.txt (line 7))
2025-10-13T00:18:03.5927141Z   Downloading jsonschema-4.25.1-py3-none-any.whl.metadata (7.6 kB)
2025-10-13T00:18:03.6118013Z Collecting pydantic-settings>=2.5.2 (from mcp>=1.9.4->-r requirements.txt (line 7))
2025-10-13T00:18:03.6157015Z   Downloading pydantic_settings-2.11.0-py3-none-any.whl.metadata (3.4 kB)
2025-10-13T00:18:03.7250403Z Collecting pydantic<3.0.0,>=2.11.0 (from mcp>=1.9.4->-r requirements.txt (line 7))
2025-10-13T00:18:03.7308458Z   Downloading pydantic-2.12.0-py3-none-any.whl.metadata (83 kB)
2025-10-13T00:18:03.7475614Z Collecting python-multipart>=0.0.9 (from mcp>=1.9.4->-r requirements.txt (line 7))
2025-10-13T00:18:03.7515266Z   Downloading python_multipart-0.0.20-py3-none-any.whl.metadata (1.8 kB)
2025-10-13T00:18:03.7699141Z Collecting sse-starlette>=1.6.1 (from mcp>=1.9.4->-r requirements.txt (line 7))
2025-10-13T00:18:03.7737509Z   Downloading sse_starlette-3.0.2-py3-none-any.whl.metadata (11 kB)
2025-10-13T00:18:03.8195659Z Collecting starlette>=0.27 (from mcp>=1.9.4->-r requirements.txt (line 7))
2025-10-13T00:18:03.8237342Z   Downloading starlette-0.48.0-py3-none-any.whl.metadata (6.3 kB)
2025-10-13T00:18:03.8514862Z Collecting uvicorn>=0.31.1 (from mcp>=1.9.4->-r requirements.txt (line 7))
2025-10-13T00:18:03.8553477Z   Downloading uvicorn-0.37.0-py3-none-any.whl.metadata (6.6 kB)
2025-10-13T00:18:03.8676723Z Collecting annotated-types>=0.6.0 (from pydantic<3.0.0,>=2.11.0->mcp>=1.9.4->-r requirements.txt (line 7))
2025-10-13T00:18:03.8715524Z   Downloading annotated_types-0.7.0-py3-none-any.whl.metadata (15 kB)
2025-10-13T00:18:04.5160342Z Collecting pydantic-core==2.41.1 (from pydantic<3.0.0,>=2.11.0->mcp>=1.9.4->-r requirements.txt (line 7))
2025-10-13T00:18:04.5204235Z   Downloading pydantic_core-2.41.1-cp311-cp311-manylinux_2_17_x86_64.manylinux2014_x86_64.whl.metadata (7.3 kB)
2025-10-13T00:18:04.5350898Z Collecting typing-inspection>=0.4.2 (from pydantic<3.0.0,>=2.11.0->mcp>=1.9.4->-r requirements.txt (line 7))
2025-10-13T00:18:04.5388557Z   Downloading typing_inspection-0.4.2-py3-none-any.whl.metadata (2.6 kB)
2025-10-13T00:18:04.5655696Z Collecting sniffio>=1.1 (from anyio>=4.5->mcp>=1.9.4->-r requirements.txt (line 7))
2025-10-13T00:18:04.5696119Z   Downloading sniffio-1.3.1-py3-none-any.whl.metadata (3.9 kB)
2025-10-13T00:18:04.6052112Z Collecting httpcore==1.* (from httpx>=0.27.1->mcp>=1.9.4->-r requirements.txt (line 7))
2025-10-13T00:18:04.6090636Z   Downloading httpcore-1.0.9-py3-none-any.whl.metadata (21 kB)
2025-10-13T00:18:04.6307826Z Collecting h11>=0.16 (from httpcore==1.*->httpx>=0.27.1->mcp>=1.9.4->-r requirements.txt (line 7))
2025-10-13T00:18:04.6368610Z   Downloading h11-0.16.0-py3-none-any.whl.metadata (8.3 kB)
2025-10-13T00:18:04.6627899Z Collecting attrs>=22.2.0 (from jsonschema>=4.20.0->mcp>=1.9.4->-r requirements.txt (line 7))
2025-10-13T00:18:04.6668991Z   Downloading attrs-25.4.0-py3-none-any.whl.metadata (10 kB)
2025-10-13T00:18:04.6826949Z Collecting jsonschema-specifications>=2023.03.6 (from jsonschema>=4.20.0->mcp>=1.9.4->-r requirements.txt (line 7))
2025-10-13T00:18:04.6884826Z   Downloading jsonschema_specifications-2025.9.1-py3-none-any.whl.metadata (2.9 kB)
2025-10-13T00:18:04.7154965Z Collecting referencing>=0.28.4 (from jsonschema>=4.20.0->mcp>=1.9.4->-r requirements.txt (line 7))
2025-10-13T00:18:04.7195822Z   Downloading referencing-0.36.2-py3-none-any.whl.metadata (2.8 kB)
2025-10-13T00:18:05.0010974Z Collecting rpds-py>=0.7.1 (from jsonschema>=4.20.0->mcp>=1.9.4->-r requirements.txt (line 7))
2025-10-13T00:18:05.0074603Z   Downloading rpds_py-0.27.1-cp311-cp311-manylinux_2_17_x86_64.manylinux2014_x86_64.whl.metadata (4.2 kB)
2025-10-13T00:18:05.0434717Z Collecting python-dotenv>=0.21.0 (from pydantic-settings>=2.5.2->mcp>=1.9.4->-r requirements.txt (line 7))
2025-10-13T00:18:05.0562996Z   Downloading python_dotenv-1.1.1-py3-none-any.whl.metadata (24 kB)
2025-10-13T00:18:05.1112206Z Collecting click>=7.0 (from uvicorn>=0.31.1->mcp>=1.9.4->-r requirements.txt (line 7))
2025-10-13T00:18:05.1153053Z   Downloading click-8.3.0-py3-none-any.whl.metadata (2.6 kB)
2025-10-13T00:18:05.1249352Z Downloading requests-2.32.5-py3-none-any.whl (64 kB)
2025-10-13T00:18:05.1375678Z Downloading charset_normalizer-3.4.3-cp311-cp311-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl (150 kB)
2025-10-13T00:18:05.1449585Z Downloading idna-3.11-py3-none-any.whl (71 kB)
2025-10-13T00:18:05.1567772Z Downloading urllib3-2.5.0-py3-none-any.whl (129 kB)
2025-10-13T00:18:05.1714794Z Downloading beautifulsoup4-4.14.2-py3-none-any.whl (106 kB)
2025-10-13T00:18:05.1917939Z Downloading lxml-6.0.2-cp311-cp311-manylinux_2_26_x86_64.manylinux_2_28_x86_64.whl (5.2 MB)
2025-10-13T00:18:05.2412585Z    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 5.2/5.2 MB 106.4 MB/s  0:00:00
2025-10-13T00:18:05.2538057Z Downloading mcp-1.17.0-py3-none-any.whl (167 kB)
2025-10-13T00:18:05.2755909Z Downloading pydantic-2.12.0-py3-none-any.whl (459 kB)
2025-10-13T00:18:05.2873056Z Downloading pydantic_core-2.41.1-cp311-cp311-manylinux_2_17_x86_64.manylinux2014_x86_64.whl (2.1 MB)
2025-10-13T00:18:05.3153618Z    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 2.1/2.1 MB 70.7 MB/s  0:00:00
2025-10-13T00:18:05.3195500Z Downloading annotated_types-0.7.0-py3-none-any.whl (13 kB)
2025-10-13T00:18:05.3291275Z Downloading anyio-4.11.0-py3-none-any.whl (109 kB)
2025-10-13T00:18:05.3365416Z Downloading certifi-2025.10.5-py3-none-any.whl (163 kB)
2025-10-13T00:18:05.3435007Z Downloading httpx-0.28.1-py3-none-any.whl (73 kB)
2025-10-13T00:18:05.3562427Z Downloading httpcore-1.0.9-py3-none-any.whl (78 kB)
2025-10-13T00:18:05.3634249Z Downloading h11-0.16.0-py3-none-any.whl (37 kB)
2025-10-13T00:18:05.3700722Z Downloading httpx_sse-0.4.3-py3-none-any.whl (9.0 kB)
2025-10-13T00:18:05.3872160Z Downloading jsonschema-4.25.1-py3-none-any.whl (90 kB)
2025-10-13T00:18:05.4011924Z Downloading attrs-25.4.0-py3-none-any.whl (67 kB)
2025-10-13T00:18:05.4154753Z Downloading jsonschema_specifications-2025.9.1-py3-none-any.whl (18 kB)
2025-10-13T00:18:05.4268603Z Downloading pydantic_settings-2.11.0-py3-none-any.whl (48 kB)
2025-10-13T00:18:05.4338182Z Downloading python_dotenv-1.1.1-py3-none-any.whl (20 kB)
2025-10-13T00:18:05.4404725Z Downloading python_multipart-0.0.20-py3-none-any.whl (24 kB)
2025-10-13T00:18:05.4482607Z Downloading referencing-0.36.2-py3-none-any.whl (26 kB)
2025-10-13T00:18:05.4559363Z Downloading rpds_py-0.27.1-cp311-cp311-manylinux_2_17_x86_64.manylinux2014_x86_64.whl (384 kB)
2025-10-13T00:18:05.4633190Z Downloading sniffio-1.3.1-py3-none-any.whl (10 kB)
2025-10-13T00:18:05.4736487Z Downloading soupsieve-2.8-py3-none-any.whl (36 kB)
2025-10-13T00:18:05.4812796Z Downloading sse_starlette-3.0.2-py3-none-any.whl (11 kB)
2025-10-13T00:18:05.4877954Z Downloading starlette-0.48.0-py3-none-any.whl (73 kB)
2025-10-13T00:18:05.4950112Z Downloading typing_extensions-4.15.0-py3-none-any.whl (44 kB)
2025-10-13T00:18:05.5010096Z Downloading typing_inspection-0.4.2-py3-none-any.whl (14 kB)
2025-10-13T00:18:05.5066332Z Downloading uvicorn-0.37.0-py3-none-any.whl (67 kB)
2025-10-13T00:18:05.5126039Z Downloading click-8.3.0-py3-none-any.whl (107 kB)
2025-10-13T00:18:05.6326129Z Installing collected packages: urllib3, typing-extensions, soupsieve, sniffio, rpds-py, python-multipart, python-dotenv, lxml, idna, httpx-sse, h11, click, charset_normalizer, certifi, attrs, annotated-types, uvicorn, typing-inspection, requests, referencing, pydantic-core, httpcore, beautifulsoup4, anyio, starlette, sse-starlette, pydantic, jsonschema-specifications, httpx, pydantic-settings, jsonschema, mcp
2025-10-13T00:18:07.1221105Z 
2025-10-13T00:18:07.1244204Z Successfully installed annotated-types-0.7.0 anyio-4.11.0 attrs-25.4.0 beautifulsoup4-4.14.2 certifi-2025.10.5 charset_normalizer-3.4.3 click-8.3.0 h11-0.16.0 httpcore-1.0.9 httpx-0.28.1 httpx-sse-0.4.3 idna-3.11 jsonschema-4.25.1 jsonschema-specifications-2025.9.1 lxml-6.0.2 mcp-1.17.0 pydantic-2.12.0 pydantic-core-2.41.1 pydantic-settings-2.11.0 python-dotenv-1.1.1 python-multipart-0.0.20 referencing-0.36.2 requests-2.32.5 rpds-py-0.27.1 sniffio-1.3.1 soupsieve-2.8 sse-starlette-3.0.2 starlette-0.48.0 typing-extensions-4.15.0 typing-inspection-0.4.2 urllib3-2.5.0 uvicorn-0.37.0
2025-10-13T00:18:08.2652871Z Collecting flake8
2025-10-13T00:18:08.3266479Z   Downloading flake8-7.3.0-py2.py3-none-any.whl.metadata (3.8 kB)
2025-10-13T00:18:08.3777520Z Collecting black
2025-10-13T00:18:08.3918053Z   Downloading black-25.9.0-cp311-cp311-manylinux_2_17_x86_64.manylinux2014_x86_64.manylinux_2_28_x86_64.whl.metadata (83 kB)
2025-10-13T00:18:08.4256295Z Collecting mccabe<0.8.0,>=0.7.0 (from flake8)
2025-10-13T00:18:08.4295665Z   Downloading mccabe-0.7.0-py2.py3-none-any.whl.metadata (5.0 kB)
2025-10-13T00:18:08.4520117Z Collecting pycodestyle<2.15.0,>=2.14.0 (from flake8)
2025-10-13T00:18:08.4657128Z   Downloading pycodestyle-2.14.0-py2.py3-none-any.whl.metadata (4.5 kB)
2025-10-13T00:18:08.4806680Z Collecting pyflakes<3.5.0,>=3.4.0 (from flake8)
2025-10-13T00:18:08.4855187Z   Downloading pyflakes-3.4.0-py2.py3-none-any.whl.metadata (3.5 kB)
2025-10-13T00:18:08.4906749Z Requirement already satisfied: click>=8.0.0 in /opt/hostedtoolcache/Python/3.11.13/x64/lib/python3.11/site-packages (from black) (8.3.0)
2025-10-13T00:18:08.4987536Z Collecting mypy-extensions>=0.4.3 (from black)
2025-10-13T00:18:08.5037646Z   Downloading mypy_extensions-1.1.0-py3-none-any.whl.metadata (1.1 kB)
2025-10-13T00:18:08.5197191Z Collecting packaging>=22.0 (from black)
2025-10-13T00:18:08.5237762Z   Downloading packaging-25.0-py3-none-any.whl.metadata (3.3 kB)
2025-10-13T00:18:08.5363776Z Collecting pathspec>=0.9.0 (from black)
2025-10-13T00:18:08.5406982Z   Downloading pathspec-0.12.1-py3-none-any.whl.metadata (21 kB)
2025-10-13T00:18:08.5605346Z Collecting platformdirs>=2 (from black)
2025-10-13T00:18:08.5641324Z   Downloading platformdirs-4.5.0-py3-none-any.whl.metadata (12 kB)
2025-10-13T00:18:08.5811496Z Collecting pytokens>=0.1.10 (from black)
2025-10-13T00:18:08.5850244Z   Downloading pytokens-0.1.10-py3-none-any.whl.metadata (2.0 kB)
2025-10-13T00:18:08.5951936Z Downloading flake8-7.3.0-py2.py3-none-any.whl (57 kB)
2025-10-13T00:18:08.6012710Z Downloading mccabe-0.7.0-py2.py3-none-any.whl (7.3 kB)
2025-10-13T00:18:08.6091824Z Downloading pycodestyle-2.14.0-py2.py3-none-any.whl (31 kB)
2025-10-13T00:18:08.6154883Z Downloading pyflakes-3.4.0-py2.py3-none-any.whl (63 kB)
2025-10-13T00:18:08.6261351Z Downloading black-25.9.0-cp311-cp311-manylinux_2_17_x86_64.manylinux2014_x86_64.manylinux_2_28_x86_64.whl (1.6 MB)
2025-10-13T00:18:08.6426971Z    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 1.6/1.6 MB 114.1 MB/s  0:00:00
2025-10-13T00:18:08.6472284Z Downloading mypy_extensions-1.1.0-py3-none-any.whl (5.0 kB)
2025-10-13T00:18:08.6531691Z Downloading packaging-25.0-py3-none-any.whl (66 kB)
2025-10-13T00:18:08.6591502Z Downloading pathspec-0.12.1-py3-none-any.whl (31 kB)
2025-10-13T00:18:08.6659711Z Downloading platformdirs-4.5.0-py3-none-any.whl (18 kB)
2025-10-13T00:18:08.6718455Z Downloading pytokens-0.1.10-py3-none-any.whl (12 kB)
2025-10-13T00:18:08.7281085Z Installing collected packages: pytokens, pyflakes, pycodestyle, platformdirs, pathspec, packaging, mypy-extensions, mccabe, flake8, black
2025-10-13T00:18:09.0431511Z 
2025-10-13T00:18:09.0454923Z Successfully installed black-25.9.0 flake8-7.3.0 mccabe-0.7.0 mypy-extensions-1.1.0 packaging-25.0 pathspec-0.12.1 platformdirs-4.5.0 pycodestyle-2.14.0 pyflakes-3.4.0 pytokens-0.1.10
2025-10-13T00:18:09.1006775Z ##[group]Run cd mcp-servers/npid-native
2025-10-13T00:18:09.1007108Z [36;1mcd mcp-servers/npid-native[0m
2025-10-13T00:18:09.1007432Z [36;1mflake8 npid_api_client.py --max-line-length=100[0m
2025-10-13T00:18:09.1007750Z [36;1mblack --check npid_api_client.py[0m
2025-10-13T00:18:09.1041999Z shell: /usr/bin/bash -e {0}
2025-10-13T00:18:09.1042244Z env:
2025-10-13T00:18:09.1042480Z   pythonLocation: /opt/hostedtoolcache/Python/3.11.13/x64
2025-10-13T00:18:09.1042886Z   PKG_CONFIG_PATH: /opt/hostedtoolcache/Python/3.11.13/x64/lib/pkgconfig
2025-10-13T00:18:09.1043437Z   Python_ROOT_DIR: /opt/hostedtoolcache/Python/3.11.13/x64
2025-10-13T00:18:09.1105417Z   Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.11.13/x64
2025-10-13T00:18:09.1105817Z   Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.11.13/x64
2025-10-13T00:18:09.1106211Z   LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.11.13/x64/lib
2025-10-13T00:18:09.1106531Z ##[endgroup]
2025-10-13T00:18:10.0037318Z npid_api_client.py:13:1: F401 'datetime.datetime' imported but unused
2025-10-13T00:18:10.0038244Z npid_api_client.py:15:1: E302 expected 2 blank lines, found 1
2025-10-13T00:18:10.0038935Z npid_api_client.py:23:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0039594Z npid_api_client.py:26:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0040220Z npid_api_client.py:37:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0041239Z npid_api_client.py:46:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0041821Z npid_api_client.py:51:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0042396Z npid_api_client.py:54:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0042990Z npid_api_client.py:57:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0043832Z npid_api_client.py:59:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0044370Z npid_api_client.py:70:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0044908Z npid_api_client.py:78:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0045469Z npid_api_client.py:80:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0045994Z npid_api_client.py:83:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0046527Z npid_api_client.py:91:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0047076Z npid_api_client.py:101:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0047630Z npid_api_client.py:108:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0048171Z npid_api_client.py:110:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0048698Z npid_api_client.py:115:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0049264Z npid_api_client.py:116:101: E501 line too long (105 > 100 characters)
2025-10-13T00:18:10.0049837Z npid_api_client.py:118:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0050368Z npid_api_client.py:127:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0050906Z npid_api_client.py:135:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0051456Z npid_api_client.py:139:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0051999Z npid_api_client.py:151:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0052569Z npid_api_client.py:157:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0053124Z npid_api_client.py:161:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0053875Z npid_api_client.py:165:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0054423Z npid_api_client.py:175:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0054978Z npid_api_client.py:177:101: E501 line too long (114 > 100 characters)
2025-10-13T00:18:10.0055552Z npid_api_client.py:179:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0056090Z npid_api_client.py:181:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0056650Z npid_api_client.py:182:101: E501 line too long (101 > 100 characters)
2025-10-13T00:18:10.0057194Z npid_api_client.py:184:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0058037Z npid_api_client.py:193:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0058578Z npid_api_client.py:196:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0059088Z npid_api_client.py:200:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0059611Z npid_api_client.py:204:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0060165Z npid_api_client.py:208:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0060682Z npid_api_client.py:212:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0061210Z npid_api_client.py:225:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0061727Z npid_api_client.py:229:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0062239Z npid_api_client.py:240:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0062758Z npid_api_client.py:252:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0063435Z npid_api_client.py:271:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0063976Z npid_api_client.py:275:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0064488Z npid_api_client.py:283:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0065011Z npid_api_client.py:289:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0065515Z npid_api_client.py:291:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0066232Z npid_api_client.py:295:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0066746Z npid_api_client.py:301:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0067267Z npid_api_client.py:305:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0067792Z npid_api_client.py:310:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0068305Z npid_api_client.py:316:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0068828Z npid_api_client.py:318:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0069337Z npid_api_client.py:322:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0069871Z npid_api_client.py:332:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0070448Z npid_api_client.py:342:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0070973Z npid_api_client.py:352:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0071483Z npid_api_client.py:356:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0071986Z npid_api_client.py:360:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0072501Z npid_api_client.py:371:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0073009Z npid_api_client.py:375:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0073722Z npid_api_client.py:384:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0074272Z npid_api_client.py:393:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0074872Z npid_api_client.py:395:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0075456Z npid_api_client.py:399:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0076001Z npid_api_client.py:401:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0076525Z npid_api_client.py:404:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0077052Z npid_api_client.py:408:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0077583Z npid_api_client.py:413:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0078136Z npid_api_client.py:419:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0078709Z npid_api_client.py:424:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0079289Z npid_api_client.py:428:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0079863Z npid_api_client.py:432:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0080428Z npid_api_client.py:435:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0081006Z npid_api_client.py:442:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0081586Z npid_api_client.py:446:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0082165Z npid_api_client.py:455:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0082945Z npid_api_client.py:468:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0083762Z npid_api_client.py:471:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0084341Z npid_api_client.py:475:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0084919Z npid_api_client.py:480:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0085518Z npid_api_client.py:485:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0086102Z npid_api_client.py:489:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0086688Z npid_api_client.py:493:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0087268Z npid_api_client.py:496:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0087850Z npid_api_client.py:503:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0088447Z npid_api_client.py:506:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0089029Z npid_api_client.py:510:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0089622Z npid_api_client.py:514:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0090197Z npid_api_client.py:518:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0090794Z npid_api_client.py:522:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0091398Z npid_api_client.py:534:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0092182Z npid_api_client.py:537:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0092809Z npid_api_client.py:541:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0093557Z npid_api_client.py:544:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0094186Z npid_api_client.py:546:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0094758Z npid_api_client.py:558:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0095326Z npid_api_client.py:563:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0096038Z npid_api_client.py:568:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0096578Z npid_api_client.py:573:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0097140Z npid_api_client.py:578:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0097721Z npid_api_client.py:583:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0098315Z npid_api_client.py:588:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0098888Z npid_api_client.py:598:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0099472Z npid_api_client.py:601:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0100092Z npid_api_client.py:602:101: E501 line too long (118 > 100 characters)
2025-10-13T00:18:10.0100720Z npid_api_client.py:605:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0101273Z npid_api_client.py:609:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0101766Z npid_api_client.py:613:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0102262Z npid_api_client.py:623:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0102753Z npid_api_client.py:625:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0103381Z npid_api_client.py:632:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0103864Z npid_api_client.py:667:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0104445Z npid_api_client.py:670:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0105038Z npid_api_client.py:672:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0105626Z npid_api_client.py:677:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0106171Z npid_api_client.py:683:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0106770Z npid_api_client.py:690:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0107344Z npid_api_client.py:697:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0107905Z npid_api_client.py:701:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0108462Z npid_api_client.py:708:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0109002Z npid_api_client.py:713:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0109787Z npid_api_client.py:718:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0110415Z npid_api_client.py:727:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0111030Z npid_api_client.py:731:1: W293 blank line contains whitespace
2025-10-13T00:18:10.0111650Z npid_api_client.py:738:11: W292 no newline at end of file
2025-10-13T00:18:10.0259217Z ##[error]Process completed with exit code 1.
2025-10-13T00:18:10.0339573Z Post job cleanup.
2025-10-13T00:18:10.1269502Z [command]/usr/bin/git version
2025-10-13T00:18:10.1305481Z git version 2.51.0
2025-10-13T00:18:10.1348078Z Temporarily overriding HOME='/home/runner/work/_temp/f9b9e981-cd36-4f4a-a29b-17ff9311500d' before making global git config changes
2025-10-13T00:18:10.1349271Z Adding repository directory to the temporary git global config as a safe directory
2025-10-13T00:18:10.1360697Z [command]/usr/bin/git config --global --add safe.directory /home/runner/work/prospect-pipeline/prospect-pipeline
2025-10-13T00:18:10.1393950Z [command]/usr/bin/git config --local --name-only --get-regexp core\.sshCommand
2025-10-13T00:18:10.1425720Z [command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'core\.sshCommand' && git config --local --unset-all 'core.sshCommand' || :"
2025-10-13T00:18:10.1652420Z [command]/usr/bin/git config --local --name-only --get-regexp http\.https\:\/\/github\.com\/\.extraheader
2025-10-13T00:18:10.1673146Z http.https://github.com/.extraheader
2025-10-13T00:18:10.1686181Z [command]/usr/bin/git config --local --unset-all http.https://github.com/.extraheader
2025-10-13T00:18:10.1716009Z [command]/usr/bin/git submodule foreach --recursive sh -c "git config --local --name-only --get-regexp 'http\.https\:\/\/github\.com\/\.extraheader' && git config --local --unset-all 'http.https://github.com/.extraheader' || :"
2025-10-13T00:18:10.2038362Z Cleaning up orphan processes
