# 物业公区巡查整改系统

巡查员上报电梯厅 / 楼道 / 垃圾房问题照片 → 保洁/维修人员通过**专属二维码**补传整改照 → 经理看板查看**整改前后配对图片**与**扣分徽章**。

## 快速启动

```bash
npm install
npm start          # 默认 http://localhost:3000
```

首次启动自动创建演示员工：王保洁（保洁）、李维修（维修）。

## 页面

| 页面 | 路径 | 说明 |
|---|---|---|
| 巡查上报 | `/` | 选区域类型（自动定扣分）→ 填位置/描述 → 拍照上传 |
| 员工整改通道 | `/staff.html?token=XXX` | 扫码进入，看待整改任务、上传整改后照片 |
| 经理看板 | `/manager.html` | 统计卡片 + 前后配对图 + 扣分徽章，30s 自动刷新 |
| 员工与日志 | `/admin.html` | 建员工、生成/重新生成 token、停用链接、操作日志 |

## 扣分规则

| 区域 | 扣分 |
|---|---|
| 电梯厅 | 2 分 |
| 楼道 | 3 分 |
| 垃圾房 | 5 分 |

## 核心机制

- **专属 token 链接**：每位员工 48 位十六进制随机 token，二维码即链接
- **重新生成 token**：旧链接立即失效（访问返回 404 并记日志）
- **停用链接**：员工无法访问/提交（返回 403 并记日志），可随时恢复
- **日志**：上报、整改、建员工、重生成 token、停用/启用、非法访问全部落盘
- **存储**：`data.json`（原子写入）+ `uploads/` 照片目录，零外部依赖

## API 一览

```
POST   /api/inspections                        巡查上报 (multipart: photo/areaType/location/...)
GET    /api/inspections?status=pending         问题列表
GET    /api/staff/:token                       员工待办与整改记录
POST   /api/staff/:token/rectify/:id           提交整改 (multipart: photo/note)
GET    /api/manager/summary                    看板统计 + 全部配对记录
GET    /api/admin/employees                    员工列表（含专属链接）
POST   /api/admin/employees                    新增员工 {name, role: cleaner|repairer}
POST   /api/admin/employees/:id/regenerate-token  重新生成 token
POST   /api/admin/employees/:id/toggle-active     停用/启用链接
GET    /api/admin/employees/:id/qrcode.png        专属二维码
GET    /api/admin/logs                         操作日志
```
