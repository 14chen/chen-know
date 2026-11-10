import java.io.BufferedOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

/**
 * Patches compiled classes into an existing Spring Boot executable jar, so a Java
 * change can go live on a machine without Maven. Every other entry keeps its
 * original compression method (nested jars must stay STORED) and bytes.
 *
 * <p>classDir is a directory tree whose contents map to BOOT-INF/classes/, e.g.
 * {@code target/classes} or a directory holding only the classes you recompiled.
 * Entries that already exist are replaced; new ones are appended.
 *
 * <p>Usage: java PatchClasses.java &lt;jar&gt; &lt;classDir&gt; &lt;outJar&gt;
 */
public final class PatchClasses {
  private static final String PREFIX = "BOOT-INF/classes/";

  public static void main(String[] args) throws Exception {
    if (args.length != 3) {
      System.err.println("usage: PatchClasses <jar> <classDir> <outJar>");
      System.exit(3);
    }
    Path jar = Paths.get(args[0]);
    Path classDir = Paths.get(args[1]);
    Path out = Paths.get(args[2]);

    if (!Files.isRegularFile(jar)) {
      System.err.println("jar not found: " + jar);
      System.exit(2);
    }
    if (!Files.isDirectory(classDir)) {
      System.err.println("class dir not found: " + classDir);
      System.exit(2);
    }
    if (out.toAbsolutePath().equals(jar.toAbsolutePath())) {
      System.err.println("refusing to overwrite the input jar; write to another path first");
      System.exit(2);
    }

    List<Path> files = new ArrayList<>();
    try (var walk = Files.walk(classDir)) {
      walk.filter(Files::isRegularFile).forEach(files::add);
    }
    if (files.isEmpty()) {
      System.err.println("class dir is empty: " + classDir);
      System.exit(2);
    }
    files.sort(Comparator.comparing(Path::toString));

    Map<String, Path> pending = new LinkedHashMap<>();
    for (Path p : files) {
      String rel = classDir.relativize(p).toString().replace(File.separatorChar, '/');
      pending.put(PREFIX + rel, p);
    }

    int kept = 0;
    int replaced = 0;
    long replacedBytes = 0;
    boolean bootLayout = false;

    try (ZipFile in = new ZipFile(jar.toFile());
         ZipOutputStream zo = new ZipOutputStream(
             new BufferedOutputStream(Files.newOutputStream(out), 1 << 20))) {
      byte[] buf = new byte[1 << 16];
      Enumeration<? extends ZipEntry> entries = in.entries();
      while (entries.hasMoreElements()) {
        ZipEntry e = entries.nextElement();
        String name = e.getName();
        if (name.startsWith(PREFIX)) {
          bootLayout = true;
        }
        Path replacement = pending.remove(name);
        if (replacement != null) {
          writeDeflated(zo, name, Files.readAllBytes(replacement));
          replaced++;
          replacedBytes += Files.size(replacement);
          continue;
        }
        copyEntry(in, zo, e, buf);
        kept++;
      }

      for (Map.Entry<String, Path> e : pending.entrySet()) {
        byte[] bytes = Files.readAllBytes(e.getValue());
        writeDeflated(zo, e.getKey(), bytes);
        replacedBytes += bytes.length;
        replaced++;
      }
    }

    if (!bootLayout) {
      Files.deleteIfExists(out);
      System.err.println("not a Spring Boot jar (no " + PREFIX + "): " + jar);
      System.exit(2);
    }

    System.out.println("kept entries     : " + kept);
    System.out.println("patched classes  : " + replaced + " (" + replacedBytes + " bytes)");
    System.out.println("out jar          : " + out + " (" + Files.size(out) + " bytes)");
  }

  private static void copyEntry(ZipFile in, ZipOutputStream zo, ZipEntry e, byte[] buf) throws IOException {
    ZipEntry copy = new ZipEntry(e.getName());
    copy.setTime(e.getTime());
    if (e.getExtra() != null) {
      copy.setExtra(e.getExtra());
    }
    if (e.getComment() != null) {
      copy.setComment(e.getComment());
    }
    if (e.getMethod() == ZipEntry.STORED) {
      copy.setMethod(ZipEntry.STORED);
      copy.setSize(e.getSize());
      copy.setCompressedSize(e.getSize());
      copy.setCrc(e.getCrc());
    } else {
      copy.setMethod(ZipEntry.DEFLATED);
    }
    zo.putNextEntry(copy);
    if (!e.isDirectory()) {
      try (InputStream is = in.getInputStream(e)) {
        int n;
        while ((n = is.read(buf)) > 0) {
          zo.write(buf, 0, n);
        }
      }
    }
    zo.closeEntry();
  }

  private static void writeDeflated(ZipOutputStream zo, String name, byte[] bytes) throws IOException {
    ZipEntry entry = new ZipEntry(name);
    entry.setMethod(ZipEntry.DEFLATED);
    entry.setTime(System.currentTimeMillis());
    zo.putNextEntry(entry);
    zo.write(bytes);
    zo.closeEntry();
  }
}
