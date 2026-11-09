package com.kb.link;

import java.util.List;

/** API.md §4：{@code {"items": [{"noteId","title","excerpt"}]}}。 */
public record BacklinkView(List<BacklinkItem> items) {
}
