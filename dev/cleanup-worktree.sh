#!/usr/bin/env bash
set -euo pipefail

# Resolve both git dirs to absolute paths so the worktree check is reliable
git_dir="$(cd "$(git rev-parse --git-dir)" && pwd)"
common_dir="$(cd "$(git rev-parse --git-common-dir)" && pwd)"

# Refuse to run outside a linked worktree so the main checkout can never self-destruct
if [ "$git_dir" = "$common_dir" ]; then
	echo "Not inside a worktree. Run this from a worktree made by make new-worktree." >&2
	exit 1
fi

worktree_path="$(git rev-parse --show-toplevel)"
main_repo="$(dirname "$common_dir")"
branch="$(git rev-parse --abbrev-ref HEAD)"

# Derive the container name from the worktree directory, matching new-worktree,
# so cleanup never depends on the env file still being present or readable
container="lumina-dev-$(basename "$worktree_path")"

echo "This permanently removes:"
echo "  worktree   $worktree_path"
echo "  branch     $branch"
echo "  container  $container and its data volume"
echo
read -r -p "Proceed? [y/N] " reply
if [[ "$reply" != [yY] ]]; then
	echo "Aborted"
	exit 0
fi

# Remove this worktree's database container
if docker rm -fv "$container" >/dev/null 2>&1; then
	echo "Removed container $container"
else
	echo "No container $container to remove"
fi

# Run the removal from the main repo since the worktree directory is about to disappear
cd "$main_repo"
git worktree remove --force "$worktree_path"
git branch -D "$branch" >/dev/null 2>&1 || true

echo "Removed the worktree and its branch"
echo "Your shell is still in the deleted directory, cd out with: cd $main_repo"
