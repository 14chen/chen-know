package com.kb.briefing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.net.spi.InetAddressResolver;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 出站解析：双栈优选 IPv4（不丢地址）、单栈与 IP 字面量原样放行、出错回落系统解析。
 *
 * <p>注：{@code InetAddressResolverProvider.Configuration} 是 JDK 的 sealed 接口，测试不能实现它，
 * 所以直接测 provider 里可测的 {@code resolve/preferIpv4} 逻辑。
 */
class BriefingIpv4FirstResolverProviderTest {

    private static final InetAddressResolver.LookupPolicy POLICY = InetAddressResolver.LookupPolicy.of(
            InetAddressResolver.LookupPolicy.IPV4 | InetAddressResolver.LookupPolicy.IPV4_FIRST);

    private static final InetAddress V4_A = address("1.2.3.4");
    private static final InetAddress V4_B = address("5.6.7.8");
    private static final InetAddress V6_A = address("2001:4860:4802:36:0:0:0:15");
    private static final InetAddress V6_B = address("2001:4860:4802:34:0:0:0:15");

    private static InetAddress address(String text) {
        try {
            return InetAddress.getByName(text);
        } catch (UnknownHostException e) {
            throw new IllegalStateException(e);
        }
    }

    private static InetAddressResolver fixed(List<InetAddress> addresses) {
        return new InetAddressResolver() {

            @Override
            public Stream<InetAddress> lookupByName(String host, LookupPolicy lookupPolicy) {
                return addresses.stream();
            }

            @Override
            public String lookupByAddress(byte[] addr) {
                return "1.2.3.4";
            }
        };
    }

    private static List<InetAddress> resolve(List<InetAddress> builtinResult) throws UnknownHostException {
        return BriefingIpv4FirstResolverProvider.resolve(fixed(builtinResult), "deepmind.google", POLICY);
    }

    @Test
    @DisplayName("双栈：IPv4 排最前，IPv6 仍保留（不丢地址）")
    void dualStackPrefersIpv4() throws Exception {
        List<InetAddress> resolved = resolve(List.of(V6_A, V4_A, V6_B, V4_B));
        assertEquals(4, resolved.size(), "不得丢弃任何地址: " + resolved);
        assertEquals(V4_A, resolved.get(0));
        assertEquals(V4_B, resolved.get(1));
        assertEquals(2, resolved.stream().filter(a -> a.getAddress().length == 16).count());
    }

    @Test
    @DisplayName("纯 IPv4 / 纯 IPv6 主机：原样放行")
    void singleStackPassesThrough() throws Exception {
        assertEquals(List.of(V4_A, V4_B), resolve(List.of(V4_A, V4_B)));
        assertEquals(List.of(V6_A, V6_B), resolve(List.of(V6_A, V6_B)));
    }

    @Test
    @DisplayName("IP 字面量（单地址）：原样放行")
    void ipLiteralPassesThrough() throws Exception {
        List<InetAddress> resolved = resolve(List.of(V4_A));
        assertEquals(1, resolved.size());
        assertInstanceOf(java.net.Inet4Address.class, resolved.get(0));
    }

    @Test
    @DisplayName("重排过程抛异常 → 回落到系统解析，不让应用失联")
    void fallsBackWhenReorderingThrows() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        InetAddressResolver flaky = new InetAddressResolver() {

            @Override
            public Stream<InetAddress> lookupByName(String host, LookupPolicy lookupPolicy) {
                if (calls.incrementAndGet() == 1) {
                    return Stream.of(V6_A, V4_A).peek(address -> {
                        throw new IllegalStateException("boom");
                    });
                }
                return Stream.of(V6_A, V4_A);
            }

            @Override
            public String lookupByAddress(byte[] addr) {
                return "1.2.3.4";
            }
        };
        List<InetAddress> resolved = BriefingIpv4FirstResolverProvider.resolve(flaky, "deepmind.google", POLICY);
        assertEquals(2, calls.get(), "第一次失败后应再问一次系统解析器");
        assertEquals(2, resolved.size());
        assertTrue(resolved.contains(V4_A) && resolved.contains(V6_A));
    }

    @Test
    @DisplayName("未知主机仍然抛 UnknownHostException（不吞错）")
    void unknownHostStillFails() {
        InetAddressResolver missing = new InetAddressResolver() {

            @Override
            public Stream<InetAddress> lookupByName(String host, LookupPolicy lookupPolicy) throws UnknownHostException {
                throw new UnknownHostException(host);
            }

            @Override
            public String lookupByAddress(byte[] addr) {
                return "1.2.3.4";
            }
        };
        org.junit.jupiter.api.Assertions.assertThrows(UnknownHostException.class,
                () -> BriefingIpv4FirstResolverProvider.resolve(missing, "no.such.host", POLICY));
    }
}
