use crate::contracts::{HubCommandError, HubWikiMergeResponse};

fn error(message: impl Into<String>) -> HubCommandError {
    HubCommandError {
        code: "invalid_request",
        message: message.into(),
        retryable: false,
    }
}

fn line_range(text: &str) -> Vec<&str> {
    text.split_inclusive('\n').collect()
}

/// Performs a conservative three-way merge. A clean result is returned only
/// when one side is unchanged, both sides are identical, or their edits occupy
/// disjoint line ranges. Ambiguous edits are explicitly returned as conflicts.
pub(crate) fn merge_text(
    base: &str,
    local: &str,
    incoming: &str,
) -> Result<HubWikiMergeResponse, HubCommandError> {
    if base.is_empty() && local.is_empty() && incoming.is_empty() {
        return Err(error("A merge requires at least one non-empty revision."));
    }
    if local == base {
        return Ok(HubWikiMergeResponse::clean(incoming));
    }
    if incoming == base || local == incoming {
        return Ok(HubWikiMergeResponse::clean(local));
    }

    let base_lines = line_range(base);
    let local_lines = line_range(local);
    let incoming_lines = line_range(incoming);
    let local_change = changed_range(&base_lines, &local_lines);
    let incoming_change = changed_range(&base_lines, &incoming_lines);
    if local_change.end <= incoming_change.start || incoming_change.end <= local_change.start {
        let mut merged: Vec<String> = base_lines.iter().map(|line| (*line).to_string()).collect();
        let first = local_change.start.min(incoming_change.start);
        let last = local_change.end.max(incoming_change.end);
        let replacement = if local_change.start <= incoming_change.start {
            splice_disjoint(
                &base_lines,
                &local_lines,
                local_change,
                &incoming_lines,
                incoming_change,
            )
        } else {
            splice_disjoint(
                &base_lines,
                &incoming_lines,
                incoming_change,
                &local_lines,
                local_change,
            )
        };
        merged.splice(first..last, replacement);
        return Ok(HubWikiMergeResponse::clean(&merged.concat()));
    }

    Ok(HubWikiMergeResponse::conflicted(local, incoming, base))
}

#[derive(Clone, Copy)]
struct ChangeRange {
    start: usize,
    end: usize,
    replacement_start: usize,
    replacement_end: usize,
}

fn changed_range(base: &[&str], revision: &[&str]) -> ChangeRange {
    let prefix = base
        .iter()
        .zip(revision.iter())
        .take_while(|(left, right)| left == right)
        .count();
    let suffix = base[prefix..]
        .iter()
        .rev()
        .zip(revision[prefix..].iter().rev())
        .take_while(|(left, right)| left == right)
        .count();
    ChangeRange {
        start: prefix,
        end: base.len().saturating_sub(suffix),
        replacement_start: prefix,
        replacement_end: revision.len().saturating_sub(suffix),
    }
}

fn splice_disjoint(
    base: &[&str],
    first_revision: &[&str],
    first: ChangeRange,
    second_revision: &[&str],
    second: ChangeRange,
) -> Vec<String> {
    let mut result = Vec::new();
    result.extend(base[..first.start].iter().map(|line| (*line).to_string()));
    result.extend(
        first_revision[first.replacement_start..first.replacement_end]
            .iter()
            .map(|line| (*line).to_string()),
    );
    result.extend(
        base[first.end..second.start]
            .iter()
            .map(|line| (*line).to_string()),
    );
    result.extend(
        second_revision[second.replacement_start..second.replacement_end]
            .iter()
            .map(|line| (*line).to_string()),
    );
    result.extend(base[second.end..].iter().map(|line| (*line).to_string()));
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unchanged_side_accepts_the_other_revision() {
        let result = merge_text("one\n", "one\n", "two\n").unwrap();
        assert_eq!(result.status, "clean");
        assert_eq!(result.content, "two\n");
    }

    #[test]
    fn identical_edits_are_clean() {
        let result = merge_text("one\n", "two\n", "two\n").unwrap();
        assert_eq!(result.status, "clean");
        assert_eq!(result.content, "two\n");
    }

    #[test]
    fn overlapping_edits_are_conflicted() {
        let result = merge_text("one\ntwo\n", "local\ntwo\n", "incoming\ntwo\n").unwrap();
        assert_eq!(result.status, "conflicted");
        assert_eq!(result.conflicts.len(), 1);
        assert_eq!(result.content, "local\ntwo\n");
    }

    #[test]
    fn disjoint_line_edits_are_merged() {
        let result = merge_text(
            "one\ntwo\nthree\n",
            "local\ntwo\nthree\n",
            "one\ntwo\nincoming\n",
        )
        .unwrap();
        assert_eq!(result.status, "clean");
        assert_eq!(result.content, "local\ntwo\nincoming\n");
    }
}
