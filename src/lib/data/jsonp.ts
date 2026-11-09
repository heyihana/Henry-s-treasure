let seq = 0;

/**
 * JSONP 请求：通过 <script> 标签跨域获取数据（行情接口普遍不支持 CORS，但支持回调参数）。
 * 超时或失败后回调替换为空函数，避免迟到的响应报错。
 */
export function jsonp<T>(
  url: string,
  params: Record<string, string | number>,
  opts: { callbackParam?: string; timeout?: number } = {},
): Promise<T> {
  const { callbackParam = 'cb', timeout = 12000 } = opts;
  return new Promise<T>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('当前环境不支持 JSONP'));
      return;
    }
    const name = `__hst_cb_${Date.now().toString(36)}_${seq++}`;
    const w = window as unknown as Record<string, unknown>;
    const script = document.createElement('script');
    let settled = false;
    const finish = () => {
      settled = true;
      clearTimeout(timer);
      w[name] = () => undefined;
      script.remove();
      setTimeout(() => delete w[name], 60000);
    };
    w[name] = (data: T) => {
      if (settled) return;
      finish();
      resolve(data);
    };
    script.onerror = () => {
      if (settled) return;
      finish();
      reject(new Error('无法连接行情接口，可能是网络受限'));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      finish();
      reject(new Error('行情接口请求超时'));
    }, timeout);
    const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), [callbackParam]: name });
    script.src = `${url}?${qs.toString()}`;
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    document.head.appendChild(script);
  });
}

/**
 * 加载一段会定义全局变量的脚本（腾讯接口使用 _var=xxx 形式），返回该变量。
 */
export function scriptVar<T>(url: string, varName: string, timeout = 12000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('当前环境不支持脚本加载'));
      return;
    }
    const w = window as unknown as Record<string, unknown>;
    const script = document.createElement('script');
    const timer = setTimeout(() => {
      script.remove();
      reject(new Error('行情接口请求超时'));
    }, timeout);
    script.onload = () => {
      clearTimeout(timer);
      const v = w[varName] as T | undefined;
      script.remove();
      delete w[varName];
      if (v === undefined) reject(new Error('行情数据为空'));
      else resolve(v);
    };
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error('无法连接行情接口'));
    };
    script.src = url;
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    document.head.appendChild(script);
  });
}
