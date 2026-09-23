## __player_stop__ — stop playback and rewind (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later

function __player_stop__ (handle)

  id = __pba_id__ (handle);
  if (id < 1), return; endif
  ## 六个字段的清理由唯一的拥有者做（含"连排定区间一起清"那条不变量）
  __pba_transition__ (id, "stop");
  __pba_enqueue__ (id, "stop");

endfunction
