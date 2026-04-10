from PIL import Image
import sys

def png_to_ico(png_path: str, ico_path: str):
    """
    PNG画像をICO形式に変換します。
    複数のサイズを自動で含めた本格的なアイコンファイルを作成します。
    """
    try:
        # PNG画像を開く
        img = Image.open(png_path)
        
        # ICOに含めるサイズ一覧（Windows/macOSでよく使われる標準サイズ）
        sizes = [
            (16, 16),   # 小さいアイコン
            (32, 32),
            (48, 48),
            (64, 64),
            (128, 128),
            (256, 256), # 高解像度用（Windows 10/11推奨）
            (512, 512)  # MacOS用の大きなサイズ（オプション）
        ]
        
        # ICO形式で保存（透明度もそのまま保持されます）
        img.save(ico_path, format="ICO", sizes=sizes)
        
        print(f"✅ 変換完了！")
        print(f"   入力: {png_path}")
        print(f"   出力: {ico_path}")
        
    except Exception as e:
        print(f"❌ エラーが発生しました: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("使い方: python png_to_ico.py 入力.png 出力.ico")
        print("例: python png_to_ico.py myimage.png myicon.ico")
        sys.exit(1)
    
    png_file = sys.argv[1]
    ico_file = sys.argv[2]
    png_to_ico(png_file, ico_file)
