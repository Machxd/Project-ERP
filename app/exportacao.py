import csv
import io
from datetime import datetime


def gerar_csv_inventario(produtos):
    saida = io.StringIO()
    writer = csv.writer(saida, delimiter=';')
    writer.writerow(["ID", "Nome", "Categoria", "Lote", "Quantidade", "Validade", "Entrada", "Preco", "Imagem URL"])
    for p in produtos:
        writer.writerow([p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7] if len(p) > 7 else 0.0, p[8] if len(p) > 8 else ""])
    return saida.getvalue()


def gerar_csv_historico(movimentos):
    saida = io.StringIO()
    writer = csv.writer(saida, delimiter=';')
    writer.writerow(["ID", "Produto", "Tipo", "Quantidade", "Data/Hora", "Motivo"])
    for m in movimentos:
        writer.writerow([m[0], m[1], m[2], m[3], m[4], m[5] or ""])
    return saida.getvalue()


def texto_pdf(valor):
    texto = str(valor if valor is not None else "")
    return texto.encode("cp1252", errors="replace").decode("cp1252")


def escapar_pdf(texto):
    return texto_pdf(texto).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def gerar_pdf_simples(titulo, cabecalhos, linhas):
    linhas_pdf = [titulo, f"Gerado em {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}", ""]
    if cabecalhos == ["ID", "Nome", "Categoria", "Lote", "Qtd", "Validade"]:
        larguras = [6, 30, 20, 18, 10, 14]
    elif cabecalhos == ["Data/Hora", "Produto", "Tipo", "Qtd", "Motivo"]:
        larguras = [19, 30, 14, 10, 34]
    else:
        larguras = [18, 24, 18, 10, 14, 14][:len(cabecalhos)]

    cabecalho = "  ".join(str(c)[:larguras[i]].ljust(larguras[i]) for i, c in enumerate(cabecalhos))
    linhas_pdf.append(cabecalho)
    linhas_pdf.append("-" * min(110, len(cabecalho)))
    for linha in linhas:
        partes = []
        for i, valor in enumerate(linha):
            largura = larguras[i] if i < len(larguras) else 16
            partes.append(texto_pdf(valor)[:largura].ljust(largura))
        linhas_pdf.append("  ".join(partes))

    paginas = [linhas_pdf[i:i + 44] for i in range(0, len(linhas_pdf), 44)] or [[]]
    objetos = [""] * (3 + len(paginas) * 2)
    objetos[1] = "<< /Type /Catalog /Pages 2 0 R >>"
    kids = []

    for idx, pagina in enumerate(paginas):
        page_obj = 3 + idx * 2
        content_obj = page_obj + 1
        kids.append(f"{page_obj} 0 R")
        comandos = ["BT", "/F1 9 Tf", "50 790 Td", "12 TL"]
        for linha in pagina:
            comandos.append(f"({escapar_pdf(linha)}) Tj")
            comandos.append("T*")
        comandos.append("ET")
        conteudo = "\n".join(comandos).encode("cp1252", errors="replace")
        objetos[page_obj] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] "
            f"/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Courier >> >> >> "
            f"/Contents {content_obj} 0 R >>"
        )
        objetos[content_obj] = f"<< /Length {len(conteudo)} >>\nstream\n{conteudo.decode('cp1252')}\nendstream"

    objetos[2] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(paginas)} >>"
    pdf = io.BytesIO()
    pdf.write(b"%PDF-1.4\n")
    offsets = [0]
    for numero in range(1, len(objetos)):
        offsets.append(pdf.tell())
        pdf.write(f"{numero} 0 obj\n{objetos[numero]}\nendobj\n".encode("cp1252", errors="replace"))
    xref = pdf.tell()
    pdf.write(f"xref\n0 {len(objetos)}\n0000000000 65535 f \n".encode("ascii"))
    for offset in offsets[1:]:
        pdf.write(f"{offset:010d} 00000 n \n".encode("ascii"))
    pdf.write(f"trailer\n<< /Size {len(objetos)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode("ascii"))
    return pdf.getvalue()
