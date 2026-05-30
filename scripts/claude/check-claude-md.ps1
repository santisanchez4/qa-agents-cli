# Non-blocking reminder for Claude Code.
#
# If important project files changed (vs HEAD) but CLAUDE.md was NOT changed,
# print a short reminder to update CLAUDE.md before committing. Both tracked
# modifications and brand-new untracked files are considered.
#
# This script is advisory only: it never edits files and always exits 0, so it
# can never block or fail the Claude Code session.

$ErrorActionPreference = 'SilentlyContinue'

# git captures native stdout as an array of lines. Stay quiet on any failure
# (e.g. not a git repo).

# Tracked, modified-vs-HEAD files.
$tracked = @()
try {
  $tracked = @(git diff --name-only HEAD 2>$null) | Where-Object { $_ -and $_.Trim() -ne '' }
} catch {
  exit 0
}

# Untracked files (porcelain lines starting with '??'). -uall lists individual
# files inside new directories instead of just the directory.
$untracked = @()
try {
  $porcelain = @(git status --porcelain --untracked-files=all 2>$null)
  foreach ($line in $porcelain) {
    if ($line -match '^\?\? (.+)$') {
      $p = $matches[1].Trim()
      # git may quote paths containing special characters.
      if ($p.StartsWith('"') -and $p.EndsWith('"')) { $p = $p.Substring(1, $p.Length - 2) }
      $untracked += $p
    }
  }
} catch { }

$changed = @($tracked + $untracked) | Where-Object { $_ -and $_.Trim() -ne '' } | Select-Object -Unique

if (-not $changed -or $changed.Count -eq 0) { exit 0 }

# CLAUDE.md already updated -> nothing to remind about.
if ($changed -contains 'CLAUDE.md') { exit 0 }

function Test-Important {
  param([string]$f)
  return ($f -like 'src/agents/*') -or
         ($f -like 'src/core/*') -or
         ($f -eq 'src/cli/help.ts') -or
         ($f -eq 'src/cli/index.ts') -or
         ($f -eq 'package.json') -or
         ($f -eq 'package-lock.json') -or
         ($f -like 'tests/*') -or
         ($f -like '.github/workflows/*')
}

$important = @($changed | Where-Object { Test-Important $_ })
if ($important.Count -eq 0) { exit 0 }

Write-Output "Reminder: important project files changed, but CLAUDE.md was not updated."
Write-Output "Consider updating CLAUDE.md before committing."
Write-Output ""
Write-Output "Changed files:"
foreach ($f in $important) {
  Write-Output "- $f"
}

exit 0
