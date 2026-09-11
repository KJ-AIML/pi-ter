<#
.SYNOPSIS
    Pi-ter Launcher with Instant ASCII Flame Animation
.DESCRIPTION
    Launches Pi with the pi-ter extension package, displaying an instant ASCII
    flame animation during the startup loading gap.
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
    # Set UTF-8 encoding
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8

    $esc = [char]27
    $cReset  = "$esc[0m"
    $cBold   = "$esc[1m"
    $cDim    = "$esc[2m"
    $cYellow = "$esc[38;2;254;240;138m" # #fef08a
    $cOrange = "$esc[38;2;255;112;67m"  # #ff7043
    $cRed    = "$esc[38;2;239;68;68m"   # #ef4444
    $cCyan   = "$esc[38;2;45;212;191m"  # #2dd4bf
    $cPink   = "$esc[38;2;244;114;182m" # #f472b6

    $origCursor = $true
    try { $origCursor = [Console]::CursorVisible; [Console]::CursorVisible = $false } catch {}

    $frameFlame = @(
        # Frame 0: Spark
        @(
            "                      .                       ",
            "                     ( )                      ",
            "                      .                       "
        ),
        # Frame 1: Small ember
        @(
            "                    (   )                     ",
            "                   (  .  )                    ",
            "                  (       )                   "
        ),
        # Frame 2: Rising flame
        @(
            "                   (  .  )                    ",
            "                  (   .   )                   ",
            "                 (  (   )  )                  "
        ),
        # Frame 3: Flame bloom
        @(
            "                  (  .      )                 ",
            "                 )           (                ",
            "                (   .  )     . )              "
        ),
        # Frame 4: Fire dancing
        @(
            "                 (  .      )                  ",
            "                )     .     (                 ",
            "               (   .  )     . )               "
        ),
        # Frame 5: Fully ON FIRE
        @(
            "                )   (   .   )  (              ",
            "               (  .      ( .   ) )            ",
            "              (    (  )   )   )   )           "
        ),
        # Frame 6: Grand Finale
        @(
            "               )   (   .   )  (               ",
            "              (  .      ( .   ) )             ",
            "              (    (  )   )   )   )           ",
            "               \  / \/ \  / \ / \ /           "
        )
    )

    $statusTitles = @(
        "IGNITING ENGINE",
        "IGNITING ENGINE",
        "HEATING UP CORES",
        "HEATING UP CORES",
        "GOING ON FIRE",
        "PI-TER IS ON FIRE!",
        "P I - T E R   R E A D Y"
    )

    $frameDelay = 65
    $totalSteps = $frameFlame.Count

    Clear-Host

    for ($idx = 0; $idx -lt $totalSteps; $idx++) {
        $flame = $frameFlame[$idx]
        $title = $statusTitles[$idx]

        # Calculate progress bar
        $pct = [Math]::Round(($idx / ($totalSteps - 1)) * 100)
        $barWidth = 20
        $filled = [Math]::Round(($idx / ($totalSteps - 1)) * $barWidth)
        $empty = $barWidth - $filled
        $barStr = "$cOrange" + ("=" * $filled) + "$cDim" + ("-" * $empty) + "$cReset"

        try { [Console]::SetCursorPosition(0, 1) } catch {}

        Write-Host "$cDim------------------------------------------------$cReset"
        
        # Render Flame lines
        for ($l = 0; $l -lt $flame.Count; $l++) {
            $line = $flame[$l]
            if ($l -eq 0) {
                Write-Host "   $cYellow$line$cReset"
            } elseif ($l -eq 1) {
                Write-Host "   $cOrange$line$cReset"
            } else {
                Write-Host "   $cRed$line$cReset"
            }
        }

        # Progress bar line
        Write-Host "            [ $barStr ] $cCyan$pct%$cReset"

        # Title line
        if ($idx -eq ($totalSteps - 1)) {
            Write-Host "             $cBold$cCyan⚡ $title ⚡$cReset"
        } elseif ($idx -ge 4) {
            Write-Host "             $cBold$cRed🔥 $title 🔥$cReset"
        } else {
            Write-Host "             $cDim⚡ $title ⚡$cReset"
        }

        Write-Host "$cDim------------------------------------------------$cReset"
        Start-Sleep -Milliseconds $frameDelay
    }

    Start-Sleep -Milliseconds 90
    try { [Console]::CursorVisible = $origCursor } catch {}
    Clear-Host
}

# Launch Pi with pi-ter extension loaded
$cmdArgs = @("-e", "$repoDir") + $PiArgs
& pi @cmdArgs
