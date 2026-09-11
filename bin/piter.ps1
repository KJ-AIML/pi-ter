<#
.SYNOPSIS
    Pi-ter Launcher with "The Creation of Adam" ASCII Animation (Hello PI)
.DESCRIPTION
    Launches Pi with the pi-ter extension package, displaying an instant ASCII
    animation of both hands reaching to the center and revealing "Hello PI".
#>

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$PiArgs
)

# Check if running non-interactive query (skip animation if -p or --version)
$isNonInteractive = $false
foreach ($arg in $PiArgs) {
    if ($arg -match '^(-p|--print|-v|--version|-h|--help)$') {
        $isNonInteractive = $true
        break
    }
}

# Resolve extension path relative to this script
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoDir   = Resolve-Path (Join-Path $scriptDir "..")

if (-not $isNonInteractive) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8

    $origCursor = $true
    try { $origCursor = [Console]::CursorVisible; [Console]::CursorVisible = $false } catch {}

    $frames = @(
        @(
            "",
            "",
            "  \u001b[38;2;248;250;252m++++*###*+=-.\u001b[0m",
            "  \u001b[38;2;248;250;252m::::.:=@@@@*#*=-.\u001b[0m",
            "  \u001b[38;2;248;250;252m.      .-+#*=:::==:\u001b[0m",
            "  \u001b[38;2;248;250;252m            :  .                                             :.:\u001b[0m",
            "  \u001b[38;2;248;250;252m                                                           :=-=######*++=+=++=*=\u001b[0m",
            "  \u001b[38;2;248;250;252m                                                              #++-+===--::..::::\u001b[0m",
            "  \u001b[38;2;248;250;252m                                                               ::-.\u001b[0m",
            "",
            ""
        ),
        @(
            "",
            "",
            "  \u001b[38;2;248;250;252m+++++++*###*+=-.\u001b[0m",
            "  \u001b[38;2;248;250;252m-::::::.:=@@@@*#*=-.\u001b[0m",
            "  \u001b[38;2;248;250;252m.. .      .-+#*=:::==:\u001b[0m",
            "  \u001b[38;2;248;250;252m               :  .                    \u001b[0m\u001b[1m\u001b[38;2;34;197;94mH\u001b[0m\u001b[38;2;248;250;252m                  :.:\u001b[0m",
            "  \u001b[38;2;248;250;252m                                                        :=-=######*++=+=++=*=+++\u001b[0m",
            "  \u001b[38;2;248;250;252m                                                           #++-+===--::..::::---\u001b[0m",
            "  \u001b[38;2;248;250;252m                                                            ::-.               .\u001b[0m",
            "",
            ""
        ),
        @(
            "",
            "",
            "  \u001b[38;2;248;250;252m+**+++++++*###*+=-.\u001b[0m",
            "  \u001b[38;2;248;250;252m===-::::::.:=@@@@*#*=-.\u001b[0m",
            "  \u001b[38;2;248;250;252m..... .      .-+#*=:::==:\u001b[0m",
            "  \u001b[38;2;248;250;252m                  :  .                \u001b[0m\u001b[1m\u001b[38;2;34;197;94mHell\u001b[0m\u001b[38;2;248;250;252m             :.:\u001b[0m",
            "  \u001b[38;2;248;250;252m                                                     :=-=######*++=+=++=*=++++++\u001b[0m",
            "  \u001b[38;2;248;250;252m                                                        #++-+===--::..::::---===\u001b[0m",
            "  \u001b[38;2;248;250;252m                                                         ::-.               ....\u001b[0m",
            "",
            ""
        ),
        @(
            "",
            "",
            "  \u001b[38;2;248;250;252m*+++**+++++++*###*+=-.\u001b[0m",
            "  \u001b[38;2;248;250;252m++====-::::::.:=@@@@*#*=-.\u001b[0m",
            "  \u001b[38;2;248;250;252m::...... .      .-+#*=:::==:\u001b[0m",
            "  \u001b[38;2;248;250;252m                     :  .           \u001b[0m\u001b[1m\u001b[38;2;34;197;94mHello PI\u001b[0m\u001b[38;2;248;250;252m        :.:\u001b[0m",
            "  \u001b[38;2;248;250;252m                                                  :=-=######*++=+=++=*=+++++++*+\u001b[0m",
            "  \u001b[38;2;248;250;252m                                                     #++-+===--::..::::---====++\u001b[0m",
            "  \u001b[38;2;248;250;252m                                                      ::-.               ......:\u001b[0m",
            "",
            ""
        ),
        @(
            "",
            "",
            "  \u001b[38;2;248;250;252m  +*+++**+++++++*###*+=-.\u001b[0m",
            "  \u001b[38;2;248;250;252m  +++====-::::::.:=@@@@*#*=-.\u001b[0m",
            "  \u001b[38;2;248;250;252m  :::...... .      .-+#*=:::==:\u001b[0m",
            "  \u001b[38;2;248;250;252m                        :  .        \u001b[0m\u001b[1m\u001b[38;2;34;197;94mHello PI\u001b[0m\u001b[38;2;248;250;252m     :.:\u001b[0m",
            "  \u001b[38;2;248;250;252m                                               :=-=######*++=+=++=*=+++++++*++\u001b[0m",
            "  \u001b[38;2;248;250;252m                                                  #++-+===--::..::::---====+++\u001b[0m",
            "  \u001b[38;2;248;250;252m                                                   ::-.               ......::\u001b[0m",
            "",
            ""
        ),
        @(
            "",
            "",
            "  \u001b[38;2;248;250;252m    +*+++**+++++++*###*+=-.\u001b[0m",
            "  \u001b[38;2;248;250;252m    +++====-::::::.:=@@@@*#*=-.\u001b[0m",
            "  \u001b[38;2;248;250;252m    :::...... .      .-+#*=:::==:\u001b[0m",
            "  \u001b[38;2;248;250;252m                          :  .    \u001b[0m\u001b[1m\u001b[38;2;56;189;248m*\u001b[0m \u001b[1m\u001b[38;2;34;197;94mHello PI\u001b[0m \u001b[1m\u001b[38;2;56;189;248m*\u001b[0m\u001b[38;2;248;250;252m :.:\u001b[0m",
            "  \u001b[38;2;248;250;252m                                             :=-=######*++=+=++=*=+++++++*++\u001b[0m",
            "  \u001b[38;2;248;250;252m                                                #++-+===--::..::::---====+++\u001b[0m",
            "  \u001b[38;2;248;250;252m                                                 ::-.               ......::\u001b[0m",
            "",
            ""
        ),
        @(
            "",
            "",
            "  \u001b[38;2;248;250;252m     +*+++**+++++++*###*+=-.\u001b[0m",
            "  \u001b[38;2;248;250;252m     +++====-::::::.:=@@@@*#*=-.\u001b[0m",
            "  \u001b[38;2;248;250;252m     :::...... .      .-+#*=:::==:\u001b[0m",
            "  \u001b[38;2;248;250;252m                           :  .   \u001b[0m\u001b[1m\u001b[38;2;56;189;248m*\u001b[0m \u001b[1m\u001b[38;2;34;197;94mHello PI\u001b[0m \u001b[1m\u001b[38;2;56;189;248m*\u001b[0m\u001b[38;2;248;250;252m:.:\u001b[0m",
            "  \u001b[38;2;248;250;252m                                            :=-=######*++=+=++=*=+++++++*++\u001b[0m",
            "  \u001b[38;2;248;250;252m                                               #++-+===--::..::::---====+++\u001b[0m",
            "  \u001b[38;2;248;250;252m                                                ::-.               ......::\u001b[0m",
            "",
            ""
        )
    )

    $frameDelay = 75
    Clear-Host

    for ($idx = 0; $idx -lt $frames.Count; $idx++) {
        $f = $frames[$idx]
        try { [Console]::SetCursorPosition(0, 2) } catch {}

        foreach ($line in $f) {
            Write-Host $line
        }

        Start-Sleep -Milliseconds $frameDelay
    }

    Start-Sleep -Milliseconds 220
    try { [Console]::CursorVisible = $origCursor } catch {}
    Clear-Host
}

# Launch Pi with pi-ter extension loaded
$cmdArgs = @("-e", "$repoDir") + $PiArgs
& pi @cmdArgs
