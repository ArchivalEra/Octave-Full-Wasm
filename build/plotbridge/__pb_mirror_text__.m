## T2/A1（2026-09-22）：把文本**同步写进真的 axes 属性**，好让 `get(gca,'title')` 这类
## 读回操作真的能用。plot 桥自己的渲染状态（__pstate__）保持不变 —— 渲染仍归桥管。
##
## 只在"已经有当前 figure"时才动（没有就不创建 figure —— 免得 `title("x")` 在没有任何
## 图的情况下凭空造一个出来，那会改变原本的报错行为）；axes 用 gca() 拿，没有就建，
## 与用户随后自己调 gca() 的行为一致。整段 try/catch 兜住：没有 toolkit 的构建里静默跳过。
function __pb_mirror_text__ (prop, t)
  try
    if (! isempty (get (0, "currentfigure")))
      a = gca ();
      if (ishandle (a))
        set (a, prop, t);
      endif
    endif
  catch
  end_try_catch
endfunction
