% IEEE 754 binary64 语义电池（issue：投产前评估；结果写 /tmp/ieee_out.txt 逐行标签）
fid = fopen('/tmp/ieee_out.txt','w');
% R1 舍入模式：round-half-to-even（IEEE 默认）
fprintf(fid, 'ROUNDF %s\n', sprintf('%.0f %.0f %.0f %.0f %.0f', 0.5, 1.5, 2.5, 3.5, 4.5));
% R2 eps 边界舍入
fprintf(fid, 'EPS17 %s\n', sprintf('%.17g', 1+eps));
fprintf(fid, 'EPSHALF %s\n', sprintf('%.17g', 1+eps/2));
% R3 溢出/下溢/次正规
fprintf(fid, 'REALMAX %s\n', sprintf('%.17g', realmax));
fprintf(fid, 'OVF %s\n', sprintf('%.17g', realmax+1e292));
fprintf(fid, 'SUBNORM %s\n', sprintf('%.17g', realmin/2));
% R4 带符号零与 NaN 的位模式
fprintf(fid, 'HEXZP %s\n', num2hex(-0.0));
fprintf(fid, 'HEXNAN %s\n', num2hex(nan));
fprintf(fid, 'HEXTHIRD %s\n', num2hex(1/3));
% R5 特殊值语义布尔
fprintf(fid, 'B1 %d\n', 1/0==Inf);
fprintf(fid, 'B2 %d\n', -1/0==-Inf);
fprintf(fid, 'B3 %d\n', 0/0!=0/0);
fprintf(fid, 'B4 %d\n', nan==nan);
fprintf(fid, 'B5 %d\n', 1/(-0.0)==-Inf);
fprintf(fid, 'B6 %d\n', isequal(-0.0,0.0));
fprintf(fid, 'B7 %d\n', Inf-Inf!=Inf-Inf);
fprintf(fid, 'B8 %d\n', -0.0<0.0);
% R6 relaxed_madd 发散度：单表达式（可被 FMA 折叠）vs 两步（必然分步舍入）
rand('twister',12345); n=1e6; a=rand(1,n); b=rand(1,n); c=rand(1,n);
v1 = a.*b + c;
t = a.*b; v2 = t + c;
k = sum(v1 ~= v2);
fprintf(fid, 'FMA1 %d\n', k);
md = 0.0; idx = find(v1 ~= v2);
if !isempty(idx)
  i1 = idx(1); md = max(abs(v1(idx)-v2(idx)) ./ max(abs(v2(idx)), realmin));
end
fprintf(fid, 'FMA2 %.6e\n', md);
% R7 BLAS（dgemm，可 FMA）vs 分步未折叠参考（同输入）
A=rand(100); B=rand(100); C=A*B;
C2=zeros(100); for i=1:100, C2(i,:)=sum(A(i,:)' .* B, 1); end
dd=(C~=C2); k2=sum(dd(:)); m2=0.0;
ii=find(dd);
if !isempty(ii), m2 = max(abs(C(ii)-C2(ii)) ./ max(abs(C2(ii)), realmin)); end
fprintf(fid, 'BLASDIFF %d %.6e\n', k2, m2);
% R8 跨车道确定性转储（固定种子 + 纯标量函数；native 对照用）
rand('twister',42); x=rand(1,8);
fprintf(fid, 'RAND42 %s\n', sprintf('%.17g ', x));
fprintf(fid, 'SIN %s\n', sprintf('%.17g %.17g', sin(0.1), sin(1.1)));
fprintf(fid, 'POW %s\n', sprintf('%.17g %.17g', 2.5^7.3, 0.1^0.3));
fprintf(fid, 'DIV %s\n', sprintf('%.17g %.17g', 1/3, 10/7));
fclose(fid);
