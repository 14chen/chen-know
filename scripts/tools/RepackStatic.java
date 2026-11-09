import java.io.BufferedOutputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Enumeration;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

/**
 * Rewrites a Spring Boot executable jar, replacing BOOT-INF/classes/static/** with
 * the files of a local directory. Every other entry keeps its original compression
 * method (nested jars must stay STORED) and bytes.
 *
 * Usage: java RepackStatic.java <jar> <staticDir> <outJar>
 */
public final class RepackStatic {
  private static final String PREFIX = "BOOT-INF/classes/static/";

  public static void main(String[] args) throws Exception {
    if (args.length != 3) {
      System.err.println("usage: RepackStatic <jar> <staticDir> <outJar>");
      System.exit(3);
    }
    Path jar = Paths.get(args[0]);
    Path staticDir = Paths.get(args[1]);
    Path out = Paths.get(args[2]);

    if (!Files.isRegularFile(jar)) {
      System.err.println("jar not found: " + jar);
      System.exit(2);
    }
    if (!Files.isDirectory(staticDir)) {
      System.err.println("static dir not found: " + staticDir);
      System.exit(2);
    }
    if (out.toAbsolutePath().equals(jar.toAbsolutePath())) {
      System.err.println("refusing to overwrite the input jar; write to another path first");
      System.exit(2);
    }

    List<Path> files = new ArrayList<>();
    try (var walk = Files.walk(staticDir)) {
      walk.filter(Files::isRegularFile).forEach(files::add);
    }
    if (files.isEmpty()) {
      System.err.println("static dir is empty: " + staticDir);
      System.exit(2);
    }
    files.sort(Comparator.comparing(Path::toString));

    long newBytes = 0;
    for (Path p : files) {
      newBytes += Files.size(p);
    }

    int copied = 0;
    int dropped = 0;
    long droppedBytes = 0;
    boolean bootLayout = false;

    try (ZipFile in = new ZipFile(jar.toFile());
         ZipOutputStream zo = new ZipOutputStream(
             new BufferedOutputStream(Files.newOutputStream(out), 1 << 20))) {
      byte[] buf = new byte[1 << 16];
      Enumeration<? extends ZipEntry> entries = in.entries();
      while (entries.hasMoreElements()) {
        ZipEntry e = entries.nextElement();
        String name = e.getName();
        if (name.startsWith("BOOT-INF/classes/")) {
          bootLayout = true;
        }
        if (name.startsWith(PREFIX)) {
          dropped++;
          droppedBytes += e.getSize();
          continue;
        }
        ZipEntry copy = new ZipEntry(name);
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
        copied++;
      }

      for (Path p : files) {
        String rel = staticDir.relativize(p).toString().replace(File.separatorChar, '/');
        ZipEntry entry = new ZipEntry(PREFIX + rel);
        entry.setMethod(ZipEntry.DEFLATED);
        entry.setTime(Files.getLastModifiedTime(p).toMillis());
        zo.putNextEntry(entry);
        Files.copy(p, zo);
        zo.closeEntry();
      }
    }

    if (!bootLayout) {
      Files.deleteIfExists(out);
      System.err.println("not a Spring Boot jar (no BOOT-INF/classes/): " + jar);
      System.exit(2);
    }

    System.out.println("kept entries   : " + copied);
    System.out.println("dropped static : " + dropped + " (" + droppedBytes + " bytes)");
    System.out.println("added static   : " + files.size() + " (" + newBytes + " bytes)");
    System.out.println("out jar        : " + out + " (" + Files.size(out) + " bytes)");
  }
}
