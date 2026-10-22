param([Parameter(Mandatory=$true)][string]$TextFile, [Parameter(Mandatory=$true)][string]$OutputFile, [string]$VoiceName = 'Microsoft Yaoyao')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$taskSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    if($VoiceName -eq 'auto'){
        $taskVoices=@($taskSynth.GetInstalledVoices()|Where-Object Enabled|ForEach-Object VoiceInfo)
        $taskVoice=$taskVoices|Where-Object {$_.Culture.Name -like 'zh-*' -and $_.Gender -eq 'Female'}|Select-Object -First 1
        if(-not $taskVoice){$taskVoice=$taskVoices|Where-Object {$_.Culture.Name -like 'zh-*'}|Select-Object -First 1}
        if(-not $taskVoice){throw 'No installed Chinese System.Speech voice. Install a Chinese Windows voice or configure a cloud TTS service.'}
        $taskSynth.SelectVoice($taskVoice.Name)
    }else{$taskSynth.SelectVoice($VoiceName)}
    $taskSynth.Rate = 0
    $taskSynth.SetOutputToWaveFile($OutputFile)
    $taskSynth.Speak([IO.File]::ReadAllText($TextFile, [Text.Encoding]::UTF8))
} finally { $taskSynth.Dispose() }
