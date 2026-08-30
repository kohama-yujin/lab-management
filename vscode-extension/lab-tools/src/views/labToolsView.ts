import * as vscode from 'vscode';

/**
 * 設定実装段階用のプレースホルダー TreeView。
 * 在室ビューワーは後続で差し替える。
 */
export class LabToolsTreeProvider implements vscode.TreeDataProvider<LabToolsTreeItem> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<LabToolsTreeItem | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	getTreeItem(element: LabToolsTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(): Thenable<LabToolsTreeItem[]> {
		return Promise.resolve([
			new LabToolsTreeItem(
				'設定',
				'右上の歯車から開く',
			),
		]);
	}
}

class LabToolsTreeItem extends vscode.TreeItem {
	constructor(label: string, description: string) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.description = description;
		this.iconPath = new vscode.ThemeIcon('info');
	}
}
