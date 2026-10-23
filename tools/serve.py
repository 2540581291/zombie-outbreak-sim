#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ZOS-R 本地静态服务器（替代 `python -m http.server`）

为什么需要它：
  `http.server` 不返回 Cache-Control，浏览器对 .js 模块会做"启发式缓存"
  （按 Last-Modified 猜一个保鲜期），结果改了 js 却还在跑旧模块 ——
  典型症状就是页面卡在「初始化」，控制台里是
  "The requested module does not provide an export named ..."。

所以这里统一对 html/js/css/json 发 no-store，改完刷新就是新的。
（图片/音频仍然允许缓存，免得每次重下几百 MB 的卫星图。）

用法：
    python tools/serve.py [端口]         默认 8777
    python tools/serve.py 8777 --open    启动后打开浏览器
"""
import http.server
import os
import socketserver
import sys
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 这些后缀每次都重新取
NO_STORE = ('.html', '.htm', '.js', '.mjs', '.css', '.json', '.webmanifest')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        path = self.path.split('?')[0].split('#')[0].lower()
        if path.endswith(NO_STORE) or path == '/' or path.endswith('/'):
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def log_message(self, fmt, *args):
        # 只报错误，正常请求不刷屏
        code = args[1] if len(args) > 1 else ''
        if isinstance(code, str) and code.startswith(('4', '5')):
            sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))


def main():
    port = 8777
    open_browser = '--open' in sys.argv
    for a in sys.argv[1:]:
        if a.isdigit():
            port = int(a)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(('127.0.0.1', port), Handler) as httpd:
        url = 'http://127.0.0.1:%d/' % port
        print('[ZOS-R] 服务已启动：%s   （根目录 %s）' % (url, ROOT))
        print('[ZOS-R] html/js/css/json 一律 no-store —— 改完刷新即可，不用强刷')
        if open_browser:
            webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n[ZOS-R] 已停止')


if __name__ == '__main__':
    main()
