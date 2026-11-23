/* 站点基类样式必须先于 Hall → engine → games/* 的模块图注入：
   否则 hall.css 排在 games/*.css 之后，同权重规则会被站点样式反压。 */
import './themes/hall/hall.css';
import Hall from './themes/hall/Hall';

export default function App() {
  return <Hall />;
}
