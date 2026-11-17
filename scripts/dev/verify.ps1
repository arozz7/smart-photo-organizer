<#
.SYNOPSIS
    Local verification gate. Run before every push; this project does not use hosted CI.

.DESCRIPTION
    Runs, in order, and stops at the first failure:
      1. Type check          (tsc --noEmit)
      2. Lint                (eslint; errors fail, warnings may not exceed the recorded baseline)
      3. File size           (no file over 900 lines; files already over may not grow)
      4. Build               (vite build of the renderer and the Electron main process)
      5. Build output        (native modules such as better-sqlite3 must not be bundled into dist-electron)
      6. TypeScript tests    (node scripts/run-tests.cjs, which handles the better-sqlite3 rebuild)
      7. Python tests        (pytest in the project venv)

    There is no code formatter configured in this repo, so there is no formatting step.
    Limits live in scripts/dev/verify-baseline.json. They only ever go DOWN: fix warnings or
    split big files, then lower the numbers (use -UpdateBaseline for the file sizes).

.PARAMETER SkipPython
    Skip the Python tests (for example when the venv is not set up).

.PARAMETER UpdateBaseline
    Rewrite the file-size part of the baseline from the current tree, then exit.
    Only use it after shrinking a file; never to hide growth.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/dev/verify.ps1
#>
[CmdletBinding()]
param(
    [switch]$SkipPython,
    [switch]$UpdateBaseline
)

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $repoRoot

$baselinePath = Join-Path $PSScriptRoot 'verify-baseline.json'
$hardLineLimit = 900
$sourceRoots = @('src', 'electron', 'tests', 'scripts')
$sourceExtensions = @('.ts', '.tsx', '.py', '.cjs', '.js', '.ps1')
$skipPathPattern = '\\(node_modules|\.venv|dist|dist-electron|build|release|coverage|__pycache__)\\'

function Get-OversizedFiles {
    $found = @{}
    foreach ($root in $sourceRoots) {
        if (-not (Test-Path $root)) { continue }
        Get-ChildItem -Path $root -Recurse -File |
            Where-Object { $sourceExtensions -contains $_.Extension -and $_.FullName -notmatch $skipPathPattern } |
            ForEach-Object {
                $lines = [System.IO.File]::ReadAllLines($_.FullName).Count
                if ($lines -gt $hardLineLimit) {
                    $relative = $_.FullName.Substring($repoRoot.Path.Length + 1).Replace('\', '/')
                    $found[$relative] = $lines
                }
            }
    }
    return $found
}

function Read-Baseline {
    if (-not (Test-Path $baselinePath)) { throw "Missing $baselinePath" }
    return Get-Content $baselinePath -Raw | ConvertFrom-Json
}

if ($UpdateBaseline) {
    $baseline = Read-Baseline
    $sizes = [ordered]@{}
    $current = Get-OversizedFiles
    foreach ($name in ($current.Keys | Sort-Object)) { $sizes[$name] = $current[$name] }
    $out = [ordered]@{ maxLintWarnings = $baseline.maxLintWarnings; oversizedFiles = $sizes }
    $out | ConvertTo-Json -Depth 4 | Set-Content -Path $baselinePath -Encoding utf8
    Write-Host "Baseline file sizes updated ($($sizes.Count) files over $hardLineLimit lines)."
    exit 0
}

$script:stepNumber = 0
function Invoke-Step {
    param([string]$Name, [scriptblock]$Action)
    $script:stepNumber++
    Write-Host ""
    Write-Host "[$script:stepNumber] $Name" -ForegroundColor Cyan
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    & $Action
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAILED: $Name (exit code $LASTEXITCODE). Stopping." -ForegroundColor Red
        exit 1
    }
    Write-Host ("ok ({0:N0}s)" -f $watch.Elapsed.TotalSeconds) -ForegroundColor Green
}

$baseline = Read-Baseline

Invoke-Step 'Type check' { npx tsc --noEmit }

Invoke-Step "Lint (errors fail; warnings capped at $($baseline.maxLintWarnings))" {
    # Same arguments as "npm run lint", called directly: npm under PowerShell drops the --max-warnings flag.
    node ./node_modules/eslint/bin/eslint.js . --ext ts,tsx --report-unused-disable-directives --max-warnings $baseline.maxLintWarnings
}

Invoke-Step "File size (limit $hardLineLimit lines)" {
    $allowed = @{}
    $baseline.oversizedFiles.PSObject.Properties | ForEach-Object { $allowed[$_.Name] = [int]$_.Value }
    $problems = @()
    $current = Get-OversizedFiles
    foreach ($name in ($current.Keys | Sort-Object)) {
        if (-not $allowed.ContainsKey($name)) {
            $problems += "$name has $($current[$name]) lines (new file over the limit; split it)"
        } elseif ($current[$name] -gt $allowed[$name]) {
            $problems += "$name grew from $($allowed[$name]) to $($current[$name]) lines (oversized files may not grow)"
        }
    }
    foreach ($problem in $problems) { Write-Host "  $problem" -ForegroundColor Red }
    $shrunk = $current.Keys | Where-Object { $allowed.ContainsKey($_) -and $current[$_] -lt $allowed[$_] }
    if ($shrunk) { Write-Host "  Tip: $(@($shrunk).Count) file(s) shrank; run with -UpdateBaseline to lower the limits." -ForegroundColor Yellow }
    $removed = $allowed.Keys | Where-Object { -not $current.ContainsKey($_) }
    if ($removed) { Write-Host "  Tip: $(@($removed).Count) file(s) are now under the limit; run with -UpdateBaseline to drop them." -ForegroundColor Yellow }
    $global:LASTEXITCODE = if ($problems.Count -gt 0) { 1 } else { 0 }
}

Invoke-Step 'Build (vite)' { node ./node_modules/vite/bin/vite.js build }

Invoke-Step 'Build output (native modules stay external)' { node scripts/dev/check-build-output.cjs }

Invoke-Step 'TypeScript tests' { node scripts/run-tests.cjs }

if ($SkipPython) {
    Write-Host ""
    Write-Host "[skipped] Python tests (-SkipPython)" -ForegroundColor Yellow
} else {
    Invoke-Step 'Python tests' {
        $python = Join-Path $repoRoot 'src\python\.venv\Scripts\python.exe'
        if (-not (Test-Path $python)) {
            Write-Host "Python venv not found at $python (use -SkipPython to skip)." -ForegroundColor Red
            $global:LASTEXITCODE = 1
            return
        }
        $env:PYTHONPATH = 'src/python'
        & $python -m pytest tests/python -q
    }
}

Write-Host ""
Write-Host "All checks passed. Safe to push." -ForegroundColor Green
