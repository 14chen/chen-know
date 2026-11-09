package com.kb.briefing;

import java.util.List;

/** BRIEFING.md §5：一个源一个实现。失败要抛 {@link BriefingFetchException} 并给出具体原因。 */
public interface BriefingFetcher {

    BriefingSource source();

    List<RawItem> fetch(int limit);
}
