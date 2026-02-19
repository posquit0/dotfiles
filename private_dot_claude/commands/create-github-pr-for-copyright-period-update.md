# Copyright Period Updater

## Description
Create GitHub pull requests for copyright period updates across one or all repositories in a GitHub organization.

## Arguments
- `organization`: GitHub organization name (e.g., `tedilabs`)
- `repository` *(optional)*: Specific repository name. If omitted, process all non-archived repositories.

## Process

### Step 1: Discover Repositories
- If a specific repository is given, use only that one.
- If no repository is given, list all non-archived repos in the org:
  ```bash
  gh repo list $ORG --limit 200 --json name,isArchived \
    --jq '.[] | select(.name | select(.isArchived == false) | .name'
  ```

### Step 2: For Each Repository — Check Copyright in README.md
- Fetch the README.md content using the GitHub API. **Important**: use `--jq` separately for `.sha` and `.content`, and strip base64 line-wrapping before decoding:
  ```bash
  README_SHA=$(gh api repos/$ORG/$REPO/contents/README.md --jq '.sha')
  README_B64=$(gh api repos/$ORG/$REPO/contents/README.md --jq '.content')
  README_CONTENT=$(echo "$README_B64" | tr -d '\n' | base64 -d)
  ```
- Check for a copyright line matching `Copyright © YYYY` or `Copyright © YYYY-NNNN`.
- If no copyright line is found, skip the repository.

### Step 3: Update Year Range (if necessary)
- Determine the current year (e.g., `2026`).
- Apply sed replacements to update the copyright end year:
  ```bash
  UPDATED=$(echo "$README_CONTENT" \
    | sed -E 's/Copyright © ([0-9]{4})-[0-9]{4}/Copyright © \1-2026/g' \
    | sed -E 's/Copyright © ([0-9]{4}), /Copyright © \1-2026, /g')
  ```
  - `YYYY-NNNN` (range) → `YYYY-2026`
  - `YYYY,` (single year followed by comma+space) → `YYYY-2026,`
- If `UPDATED` equals the original content, skip (already up to date or no match).

### Step 4: Create Branch and Commit
- Branch name: `chore/update-copyright-{year}` (e.g., `chore/update-copyright-2026`)
  ```bash
  DEFAULT_BRANCH=$(gh api repos/$ORG/$REPO --jq '.default_branch')
  SHA=$(gh api repos/$ORG/$REPO/git/refs/heads/$DEFAULT_BRANCH --jq '.object.sha')
  gh api repos/$ORG/$REPO/git/refs -f ref="refs/heads/$BRANCH" -f sha="$SHA" 2>/dev/null || true
  ```
- Encode and commit the updated README.md:
  ```bash
  ENCODED=$(printf '%s' "$UPDATED" | base64)
  gh api repos/$ORG/$REPO/contents/README.md \
    -X PUT \
    -f message="chore: update copyright year to 2026" \
    -f "content=$ENCODED" \
    -f sha="$README_SHA" \
    -f branch="$BRANCH"
  ```

### Step 5: Create Pull Request
- Create a PR from the branch to the default branch:
  ```bash
  gh pr create --repo $ORG/$REPO \
    --title "chore: update copyright year to 2026" \
    --body "Update copyright year to 2026 in README.md." \
    --base "$DEFAULT_BRANCH" \
    --head "$BRANCH"
  ```
- If a PR already exists for the branch, retrieve and report the existing PR URL.
- If no update was needed, do not create a PR.

### Step 6: Report Results
- Print a summary table of all repositories processed, showing:
  - Repository name
  - Old copyright line → New copyright line
  - PR URL (or "skipped" if no change needed)
