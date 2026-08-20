# dsh-plugin-uw

> 联合工作区插件 — 将多个目录合并到一个会话中，让 AI 助手同时访问所有成员目录。

[English](./README.en.md) | 中文

[![GitHub](https://img.shields.io/badge/GitHub-lcgash/dsh--plugin--uw-blue?style=flat-square&logo=github)](https://github.com/lcgash/dsh-plugin-uw)
[![Gitee](https://img.shields.io/badge/Gitee-mr--chenguang/dsh--plugin--uw-red?style=flat-square&logo=gitee)](https://gitee.com/mr-chenguang/dsh-plugin-uw)
[![npm](https://img.shields.io/npm/v/dsh-union-workspace?style=flat-square&logo=npm)](https://www.npmjs.com/package/dsh-union-workspace)

---

## 解决什么问题

做前后端联调的时候，代码通常散落在好几个仓库里——前端、后端、公共类型定义各在各的目录。AI 要完成一次跨端修改，得同时看到并修改所有这些目录的文件。

只挂一个目录，AI 看不到别的仓库，跨端任务根本做不了。挂一个大目录（比如整个主目录）呢，又得承受**上下文爆炸**的代价：工具扫描和文件检索扩散到无数无关文件里，既浪费 token、又降低回答质量，还给了远超实际需要的目录权限。

**联合工作区**让你把**恰好需要的几个目录**合并进一个会话。AI 同时访问所有成员目录，但范围始终精确可控——它只看到你选定的目录，看不到范围外的任何文件。

## 简介

`dsh-plugin-uw`（联合工作区插件）允许你在 DSH Web GUI 中将多个目录合并到一个会话中。一个**主目录**（primary）加一个或多个**成员目录**（members）组成一个**联合工作区**（union workspace），AI 助手可以同时访问所有成员目录的文件。

## 截图

| 会话文件浏览 | 设置页面 |
|---|---|
| ![main](docs/screenshots/main.png) | ![setting](docs/screenshots/setting.png) |

## 功能

- **联合工作区** — 将两个或更多目录组合到一个会话中，AI 助手可同时访问所有成员目录。
- **两种权限预设**：

  | 预设 | 说明 |
  |---|---|
  | `workspace-write`（默认） | 主目录和成员目录均可读写（成员目录通过 `uw_write`/`uw_edit` 工具） |
  | `danger-full-access` | 所有目录可读写（无限制） |

- **侧边栏集成** — 点击侧边栏底部的 ⛓ 图标打开管理面板。
- **管理面板** — 侧边栏右侧面板，两个标签页：
  - **工作区**：创建、删除、修改联合工作区，以及成员目录管理。
  - **文件浏览**：以树形结构浏览成员目录（懒加载，支持递归展开）。
- **快速升级** — 已有会话可通过 `/uw` 命令升级为联合工作区，或从会话头部按钮打开创建面板。
- **持久化存储** — 联合工作区定义保存在 `~/.dsh/union-workspaces.json`，重启后依然有效。
- **自动匹配** — 在侧边栏打开的工作区如果标题匹配某个联合工作区，自动标记为该联合工作区。
- **成员目录工具** — 注册了 `uw_read`、`uw_write`、`uw_edit` 三个工具，AI 助手可直接通过成员目录路径读写文件，不受沙箱限制。所有成员目录均可读写。

## 安装

### 通过 DSH 插件命令安装

```bash
# 从 GitHub 安装
dsh plugin add github:lcgash/dsh-plugin-uw

# 或指定 profile 安装（将 <name> 替换为你的 profile 名称）
dsh plugin --profile <name> add github:lcgash/dsh-plugin-uw
```

### 从 npm 安装

```bash
# 全局安装
npm install -g dsh-union-workspace

# 或安装到 DSH profile（将 <name> 替换为你的 profile 名称）
dsh plugin --profile <name> add dsh-union-workspace
```

### 从源码安装

```bash
# 克隆仓库
git clone https://github.com/lcgash/dsh-plugin-uw.git
cd dsh-plugin-uw

# 安装依赖
npm install

# 构建
npm run build

# 安装到 DSH profile（将 <name> 替换为你的 profile 名称）
dsh plugin --profile <name> add link:$(pwd)
```

安装后，在 `cordis.patch.yml` 中应包含以下插件行：

```yaml
- insert:
    - id: union-workspace
      name: 'dsh-union-workspace'
```

## 使用

1. 在侧边栏底部点击 ⛓ 图标，或输入 `/uw` 命令。
2. 选择创建模式：
   - **快速模式**：选择多个目录，自动生成名称。
   - **自定义模式**：设置名称、选择成员目录、选择权限预设。
3. 创建成功后，在侧边栏会出现对应的工作区。
4. 点击侧边栏的工作区，打开的新会话会自动应用联合工作区。
5. 在会话头部右侧点击 ⛓ 按钮，展开成员目录文件列表面板。
6. AI 助手可通过 `uw_read` / `uw_write` / `uw_edit` 工具直接读写成员目录中的文件（标准 `read` / `write` / `edit` 工具受沙箱限制只能访问主目录）。

## 开发

```bash
# 构建
npm run build

# 类型检查
npm run typecheck
```

## 架构

- **Host 端**（`src/index.ts`）— 运行在 DSH Node.js 进程中，持有联合工作区存储（`~/.dsh/union-workspaces.json`），提供 `/api/dsh-union-workspace/*` 路由，并在会话启动时应用权限预设。
- **Client 端**（`src/client/index.ts`）— 运行在 Web GUI 中，注册本地化字典、设置页面、会话头部按钮、`/uw` 命令，并通过 DOM 注入挂载覆盖层和文件面板。
- **路由**（`src/routes.ts`）— REST API 端点，用于列出、同步、标记和浏览联合工作区。
- **工具**（`src/tools.ts`）— 注册 `uw_read`、`uw_write`、`uw_edit` 三个模型工具，用于读写成员目录文件，绕过沙箱的单根限制。
- **存储**（`src/store.ts`）— 基于文件的持久化存储，支持数据清洗和迁移。

## License

Apache-2.0