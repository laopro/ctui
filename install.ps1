$ErrorActionPreference = "Stop"
$installDir = "$env:LOCALAPPDATA\ctui"

if (Test-Path "$installDir\.git") {
  Write-Host "Updating existing install at $installDir"
  git -C $installDir pull --ff-only
} else {
  Write-Host "Cloning ctui to $installDir"
  git clone --depth 1 https://github.com/laopro/ctui.git $installDir
}

Push-Location $installDir
npm install --no-fund --no-audit
Pop-Location

$binDir = "$installDir\bin"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$binDir*") {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$binDir", "User")
  Write-Host "Added $binDir to your PATH."
  Write-Host "Open a new terminal, then run: ctui"
} else {
  Write-Host "Installed. Run: ctui"
}
