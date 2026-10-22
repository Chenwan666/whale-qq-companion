param([ValidateSet('menu','start','stop','configure','doctor','extras')][string]$Action='menu',[switch]$NoBrowser)
$ErrorActionPreference='Stop'
try{[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false);$OutputEncoding=[Console]::OutputEncoding}catch{}
$taskRoot=Split-Path $PSScriptRoot -Parent
$taskBridge=Join-Path $taskRoot 'qq-bridge'
$taskRuntime=Join-Path $taskRoot 'qq-bridge-runtime'
$taskEdition=(Get-Content -LiteralPath (Join-Path $taskBridge 'release.json') -Raw -Encoding UTF8|ConvertFrom-Json).edition
$taskConfigFile=Join-Path $taskBridge 'config.json'
$taskLogs=Join-Path $taskRoot 'launcher-logs'
New-Item -ItemType Directory -Path $taskRuntime,$taskLogs,(Join-Path $taskRuntime 'temp') -Force|Out-Null
$env:TEMP=Join-Path $taskRuntime 'temp';$env:TMP=$env:TEMP
$env:DSH_HOME=Join-Path $taskRuntime 'home'
$env:npm_config_cache=Join-Path $taskRuntime 'npm-cache'
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD='1'
$env:PLAYWRIGHT_BROWSERS_PATH=Join-Path $taskRuntime 'browsers'
$env:XDG_CACHE_HOME=Join-Path $taskRuntime 'model-cache'
$env:HF_HOME=Join-Path $taskRuntime 'model-cache\huggingface'
$env:TORCH_HOME=Join-Path $taskRuntime 'model-cache\torch'
$env:COREPACK_HOME=Join-Path $taskRuntime 'corepack'
$env:npm_config_store_dir=Join-Path $taskRuntime 'pnpm-store'
$env:npm_config_devdir=Join-Path $taskRuntime 'node-gyp'
$env:QQ_BRIDGE_SKIP_DSH_INSTALL='1'
$env:PATH=(Join-Path $taskRuntime 'node_modules\.bin')+';'+$env:PATH
function Stage([int]$n,[string]$text){Write-Host ('[{0}/7] {1}' -f $n,$text) -ForegroundColor Cyan}
function InvokeNpm([string]$name,[string[]]$arguments){
 $command=Get-Command npm.cmd -ErrorAction Stop;$cli=Join-Path (Split-Path $command.Source -Parent) 'node_modules\npm\bin\npm-cli.js';if(-not(Test-Path -LiteralPath $cli)){throw '找不到Node配套npm CLI，请重新安装Node.js。'}
 $quoted=@((@($cli)+$arguments)|ForEach-Object {'"'+$_.Replace('"','\"')+'"'});$out=Join-Path $taskLogs ($name+'.out.log');$err=Join-Path $taskLogs ($name+'.err.log')
 $child=Start-Process -FilePath $script:taskNode -ArgumentList $quoted -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
 $null=$child.Handle
 @{pid=$child.Id;name=$name}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $taskRuntime 'installer.json') -Encoding UTF8
 $clock=[Diagnostics.Stopwatch]::StartNew();try{while(-not $child.HasExited){Write-Host ('  '+$name+' 安装中 · '+[int]$clock.Elapsed.TotalSeconds+'秒；详细日志见launcher-logs');if($clock.Elapsed.TotalMinutes-gt 20){StopTree $child.Id;throw '依赖安装超过20分钟，请检查网络后重试；没有启动聊天服务。'};Start-Sleep -Seconds 5};$child.WaitForExit();if($child.ExitCode-ne 0){if(Test-Path -LiteralPath $err){Get-Content -LiteralPath $err -Tail 8};throw ($name+' 安装失败，错误已保存在日志中')}}finally{Remove-Item -LiteralPath (Join-Path $taskRuntime 'installer.json') -ErrorAction SilentlyContinue}
}
function NodeCommand { $c=Get-Command node.exe -ErrorAction SilentlyContinue;if(-not $c){throw '未找到 Node.js。请先安装 Node.js 24 LTS，重新打开此窗口后再启动。官方地址：https://nodejs.org/'};return $c.Source }
function PortOwner([int]$port){return Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue|Select-Object -First 1}
function OwnedProcess([int]$id){$p=Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue;if(-not $p -or -not $p.CommandLine){return $null};if($p.CommandLine.IndexOf($taskRoot,[StringComparison]::OrdinalIgnoreCase)-lt 0){return $null};return $p}
function StopTree([int]$id){$children=Get-CimInstance Win32_Process -Filter "ParentProcessId=$id" -ErrorAction SilentlyContinue;foreach($child in $children){StopTree ([int]$child.ProcessId)};Stop-Process -Id $id -ErrorAction SilentlyContinue}
function StopOwned {
 $installer=Join-Path $taskRuntime 'installer.json';if(Test-Path -LiteralPath $installer){$pending=Get-Content -LiteralPath $installer -Raw|ConvertFrom-Json;if(OwnedProcess ([int]$pending.pid)){StopTree ([int]$pending.pid)};Remove-Item -LiteralPath $installer -ErrorAction SilentlyContinue}
 if(Test-Path -LiteralPath $taskConfigFile){try{$stopCfg=Get-Content -LiteralPath $taskConfigFile -Raw -Encoding UTF8|ConvertFrom-Json;$port=PortOwner ([int]$stopCfg.consolePort);if($port -and (OwnedProcess ([int]$port.OwningProcess))){Invoke-RestMethod ('http://127.0.0.1:'+([string]$stopCfg.consolePort)+'/api/restart') -Method Post -Headers @{'x-console-token'=$stopCfg.consoleToken} -ContentType 'application/json' -Body '{}' -TimeoutSec 5|Out-Null;Start-Sleep -Milliseconds 1500}}catch{}}
 $file=Join-Path $taskRuntime 'services.json'
 $rows=@();if(Test-Path -LiteralPath $file){$rows=Get-Content -LiteralPath $file -Raw|ConvertFrom-Json;foreach($row in $rows){if(OwnedProcess ([int]$row.pid)){StopTree ([int]$row.pid)}};Start-Sleep -Milliseconds 400}
 $remaining=@($rows|Where-Object {OwnedProcess ([int]$_.pid)});if($remaining.Count -eq 0){Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue}
 $report=@{finishedAt=[DateTime]::UtcNow.ToString('o');completed=($remaining.Count-eq 0);status=$(if($remaining.Count){'incomplete'}else{'stopped'});forced=@();remaining=$remaining;hookUnload='QQ接入端保持运行';note='Only recorded processes belonging to this extracted package were stopped.'}
 [IO.File]::WriteAllText((Join-Path $taskLogs 'shutdown-latest.json'),($report|ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
 if($remaining.Count){throw '还有本包进程未退出，请查看停止报告，勿重复启动。'}
 Write-Host '本分享包已停止。QQ 客户端和独立接入端保持当前状态。' -ForegroundColor Green
}
function RecordService($row){$script:taskServices=@($script:taskServices|Where-Object {$_.pid -ne $row.pid})+@($row);$script:taskServices|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $taskRuntime 'services.json') -Encoding UTF8;return $row}
function StartOwned([string]$name,[int]$port,[string]$cwd,[string[]]$arguments){
 $owner=PortOwner $port
 if($owner){if(-not(OwnedProcess ([int]$owner.OwningProcess))){throw ('端口 '+$port+' 被其他程序使用。请先停止旧实例，或在配置中换端口。')};return RecordService @{name=$name;pid=[int]$owner.OwningProcess;port=$port}}
 $p=Start-Process -FilePath $script:taskNode -ArgumentList $arguments -WorkingDirectory $cwd -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskLogs ($name+'.out.log')) -RedirectStandardError (Join-Path $taskLogs ($name+'.err.log'))
 $row=RecordService @{name=$name;pid=$p.Id;port=$port}
 $deadline=[DateTime]::UtcNow.AddSeconds(90);$watch=[Diagnostics.Stopwatch]::StartNew();$bucket=-1
 do{if(PortOwner $port){return $row};if($p.HasExited){throw ($name+' 启动退出，请查看 launcher-logs 中对应的 err.log')};$next=[int]($watch.Elapsed.TotalSeconds/5);if($next -ne $bucket){$bucket=$next;Write-Host ('  等待 '+$name+' · '+[int]$watch.Elapsed.TotalSeconds+' 秒')};Start-Sleep -Milliseconds 500}while([DateTime]::UtcNow-lt $deadline)
 throw ($name+' 就绪超时，已保留日志；不要重复双击多个启动窗口。')
}
try{
 if($Action -eq 'menu'){
  Write-Host "`n  小鲸鱼 · 分享版 $taskEdition" -ForegroundColor Cyan
  Write-Host '  1 启动并打开小窝（回车默认）  2 彻底停止本包'
  Write-Host ('  3 本地配置  4 只读诊断  5 安装'+$(if($taskEdition-eq 'ultimate'){'文档/语音'}else{'文档解析'})+'可选依赖')
  $choice=Read-Host '请选择';$Action=switch($choice){'2'{'stop'}'3'{'configure'}'4'{'doctor'}'5'{'extras'}default{'start'}}
 }
 if($Action -eq 'stop'){StopOwned;exit 0}
 $script:taskNode=NodeCommand
 $nodeVersion=[version](((& $script:taskNode --version)|Select-Object -Last 1).Trim().TrimStart('v'))
 if($nodeVersion -lt [version]'22.13.0'){throw '需要 Node.js 22.13 或以上，推荐 Node.js 24 LTS。'}
 if($Action -eq 'doctor'){& $script:taskNode (Join-Path $PSScriptRoot 'doctor.mjs');exit $LASTEXITCODE}
 if($Action -eq 'extras'){
  $python=Get-Command python.exe -ErrorAction SilentlyContinue;if(-not $python){throw '请先从 python.org 安装 Python 3.11 或 3.12，并启用 Add python.exe to PATH。'}
  $folder=if($taskEdition -eq 'ultimate'){'voice-env'}else{'document-env'}
  $venv=Join-Path $taskRuntime $folder
  if(-not(Test-Path -LiteralPath (Join-Path $venv 'Scripts\python.exe'))){& $python.Source -m venv $venv;if($LASTEXITCODE -ne 0){throw 'Python 虚拟环境创建失败'}}
  $packages=if($taskEdition -eq 'ultimate'){@('pypdf==6.20.1','python-docx==1.2.0','Pillow==12.3.0','aiohttp==3.14.5','edge-tts==7.2.8','imageio-ffmpeg==0.6.0')}else{@('pypdf==6.20.1','python-docx==1.2.0','Pillow==12.3.0')}
  & (Join-Path $venv 'Scripts\python.exe') -m pip install --cache-dir (Join-Path $taskRuntime 'pip-cache') @packages
  if($LASTEXITCODE -ne 0){throw '可选依赖安装失败，日志中的具体包名可用于排查；聊天主体仍可运行。'}
  Write-Host '可选依赖已安装。' -ForegroundColor Green;exit 0
 }
 if($Action -eq 'configure'){
  if(PortOwner 3119){throw '请先从本启动菜单停止本包，再修改配置。'}
  & $script:taskNode (Join-Path $PSScriptRoot 'setup-server.mjs');if($LASTEXITCODE -ne 0){throw '本地配置未完成'};exit 0
 }
 $hasher=[Security.Cryptography.SHA256]::Create();try{$taskLockId=[BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($taskRoot.ToLowerInvariant()))).Replace('-','')}finally{$hasher.Dispose()}
 $mutex=New-Object Threading.Mutex($false,('Local\WhalePublic'+$taskLockId))
 $locked=$mutex.WaitOne(0);if(-not $locked){throw '已有启动窗口正在运行，请查看那个窗口。'}
 Stage 1 '检查本包依赖；首次启动需要联网'
 if(-not(Test-Path -LiteralPath (Join-Path $taskBridge 'node_modules\zod\package.json'))){InvokeNpm 'bridge-dependencies' @('ci','--prefix',$taskBridge,'--no-audit','--no-fund')}
 Stage 2 '安装隔离的 AI 后台（不会使用其他项目的账号）'
 if(-not(Test-Path -LiteralPath (Join-Path $taskRuntime 'node_modules\@deepseek-ai\dsh\lib\bin.js'))){
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'runtime\package.json') -Destination (Join-Path $taskRuntime 'package.json')
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'runtime\package-lock.json') -Destination (Join-Path $taskRuntime 'package-lock.json')
  [IO.File]::WriteAllText((Join-Path $taskRuntime '.npmrc'),"legacy-peer-deps=false`n")
  InvokeNpm 'dsh-dependencies' @('ci','--prefix',$taskRuntime,'--no-audit','--no-fund')
 }
 Stage 3 '首次配置与通用角色卡'
 if(-not(Test-Path -LiteralPath $taskConfigFile)){& $script:taskNode (Join-Path $PSScriptRoot 'setup-server.mjs');if($LASTEXITCODE -ne 0 -or -not(Test-Path -LiteralPath $taskConfigFile)){throw '请完成本地设置窗口'}}
 $cfg=Get-Content -LiteralPath $taskConfigFile -Raw -Encoding UTF8|ConvertFrom-Json
 $secret=Join-Path $taskBridge 'state\provider-secret.json';if(Test-Path -LiteralPath $secret){$ownKey=(Get-Content -LiteralPath $secret -Raw|ConvertFrom-Json).apiKey}
 Stage 4 '注册本包的聊天预设与工具'
 $presetStamp=Join-Path $taskRuntime 'preset-ready.txt';if(-not(Test-Path -LiteralPath $presetStamp)){
  $profilePackage=Join-Path $env:DSH_HOME 'profiles\web\package.json'
  if(-not(Test-Path -LiteralPath $profilePackage)){
   & $script:taskNode (Join-Path $taskRuntime 'node_modules\@deepseek-ai\dsh\lib\bin.js') web --dump-default-config > (Join-Path $taskLogs 'initial-profile.yml')
   if($LASTEXITCODE -ne 0){throw 'DSH 初始web配置生成失败，请查看日志。'}
  }
  & $script:taskNode (Join-Path $taskBridge 'scripts\setup-dsh.mjs') web
  if($LASTEXITCODE -ne 0){throw 'DSH 预设安装失败'}
  [IO.File]::WriteAllText($presetStamp,'2026.10.22')
 }
 Stage 5 '启动 AI 与消息桥接'
 $script:taskServices=@();$rows=@();$oldModelKey=$env:DEEPSEEK_API_KEY;try{if($ownKey){$env:DEEPSEEK_API_KEY=$ownKey};$rows+=StartOwned 'dsh-public' ([uri]$cfg.dsh.baseUrl).Port $taskRoot @(('"'+(Join-Path $taskRuntime 'node_modules\@deepseek-ai\dsh\lib\bin.js')+'"'),'web','--host','127.0.0.1','--port',([string]([uri]$cfg.dsh.baseUrl).Port),'--no-open')}finally{$env:DEEPSEEK_API_KEY=$oldModelKey}
 $rows+=StartOwned 'bridge-public' ([int]$cfg.consolePort) $taskBridge @(('"'+(Join-Path $taskBridge 'src\bridge.js')+'"'))
 $rows|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $taskRuntime 'services.json') -Encoding UTF8
 Stage 6 '读取健康状态（不调用付费模型）'
 $url='http://127.0.0.1:'+([string]$cfg.consolePort)
 $deadline=[DateTime]::UtcNow.AddSeconds(60);$health=$null;do{try{$health=Invoke-RestMethod ($url+'/api/status') -Headers @{'x-console-token'=$cfg.consoleToken} -TimeoutSec 5}catch{};if($health.dshReady){break};Write-Host '  等待 AI 事件连接就绪…';Start-Sleep -Seconds 2}while([DateTime]::UtcNow-lt $deadline);if(-not $health.dshReady){throw 'AI后台监听已启动，但桥接连接尚未就绪，请查看日志。'}
 Write-Host ('  AI连接：'+[string]$health.dshReady+'；QQ接入：'+[string]$health.snowluma.connected)
 Stage 7 '打开小窝'
 if(-not $NoBrowser){Start-Process ($url+'/companion?token='+[uri]::EscapeDataString($cfg.consoleToken))}
 Write-Host '启动完成。关闭此窗口或网页不等于停止服务；请用小窝的停止按钮或本菜单 2。' -ForegroundColor Green
}catch{Write-Host ('未完成：'+$_.Exception.Message) -ForegroundColor Red;Write-Host ('日志目录：'+$taskLogs);exit 1}
finally{if($locked){$mutex.ReleaseMutex()};if($mutex){$mutex.Dispose()}}
