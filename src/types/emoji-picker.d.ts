// 声明 emoji-picker Web Component，兼容其自定义属性
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'emoji-picker': any;
    }
  }
}

export {};
