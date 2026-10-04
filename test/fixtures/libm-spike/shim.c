/* libm-spike 探针 shim（工单 60）：只在"覆盖变体"里链接——
 * octave_libm_override_version 是覆盖对象的独有符号（musl/libc 没有它），
 * 兼作两件事：① driver 断言"覆盖真的链进来了"；② 生产插件的产物探针
 * （--export-if-defined=octave_libm_override_version，write-build-manifest 从导出段量）。
 */
__attribute__((export_name("octave_libm_override_version")))
int octave_libm_override_version(void) { return 20261004; }
