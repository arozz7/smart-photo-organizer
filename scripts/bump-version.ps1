param (
    [string]$Type = "patch" 
)

$packageJsonPath = Join-Path $PSScriptRoot "..\package.json"
# Read raw content to preserve formatting logic later if we did manually, 
# but for now we'll just read it normally.
$content = Get-Content $packageJsonPath -Raw

if ($content -match '"version":\s*"([^"]+)"') {
    $currentVersion = $matches[1]
    Write-Host "Current version: $currentVersion"

    $versionParts = $currentVersion.Split('.')
    $major = [int]$versionParts[0]
    $minor = [int]$versionParts[1]
    $patch = [int]$versionParts[2]

    switch ($Type) {
        "major" { $major++; $minor = 0; $patch = 0 }
        "minor" { $minor++; $patch = 0 }
        "patch" { $patch++ }
        Default { Write-Error "Invalid bump type. Use 'major', 'minor', or 'patch'."; exit 1 }
    }

    $newVersion = "$major.$minor.$patch"
    
    # Use Regex Replace to verify we only change the version key
    $newContent = $content -replace """version"":\s*""$currentVersion""", """version"": ""$newVersion"""
    
    $newContent | Set-Content $packageJsonPath
    Write-Host "Bumped version to: $newVersion"
} else {
    Write-Error "Could not find version in package.json"
}
