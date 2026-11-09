package com.kb.briefing;

import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.net.spi.InetAddressResolver;
import java.net.spi.InetAddressResolverProvider;
import java.util.List;
import java.util.stream.Stream;

/**
 * 出站域名解析：主机<b>同时</b>有 A 和 AAAA 记录时，把 IPv4 排在前面。
 *
 * <p>背景：本机 IPv6 到部分站点（如 deepmind.google 的 Google 前端）连不通，JDK HttpClient 只看第一个地址，
 * 挑中 IPv6 就一直挂到超时；curl 用的是另一套选择逻辑所以正常。
 *
 * <p>边界（有意收窄，见任务书约束）：
 * <ul>
 *   <li>只调整顺序，<b>不丢弃任何地址</b>：IPv6 仍在列表里，IPv4 不可用还能回落</li>
 *   <li>纯 A 或纯 AAAA 的主机原样放行；IP 字面量原样放行</li>
 *   <li>自身任何运行时异常都回落到系统解析 —— 绝不让解析器的 bug 让整个应用失联</li>
 *   <li>只影响出站解析，不影响监听 socket 的地址族（Tomcat 仍是双栈）</li>
 * </ul>
 */
public class BriefingIpv4FirstResolverProvider extends InetAddressResolverProvider {

    @Override
    public String name() {
        return "kb-briefing-ipv4-first";
    }

    @Override
    public InetAddressResolver get(Configuration configuration) {
        InetAddressResolver builtin = configuration.builtinResolver();
        return new InetAddressResolver() {

            @Override
            public Stream<InetAddress> lookupByName(String host, LookupPolicy lookupPolicy)
                    throws UnknownHostException {
                return resolve(builtin, host, lookupPolicy).stream();
            }

            @Override
            public String lookupByAddress(byte[] addr) throws UnknownHostException {
                return builtin.lookupByAddress(addr);
            }
        };
    }

    /**
     * 解析并按需重排。<b>任何运行时异常都退回一次系统解析</b>，保证解析器自身的问题不会让应用失联。
     */
    static List<InetAddress> resolve(InetAddressResolver builtin, String host,
            InetAddressResolver.LookupPolicy lookupPolicy) throws UnknownHostException {
        Stream<InetAddress> resolved = builtin.lookupByName(host, lookupPolicy);
        try {
            return preferIpv4(resolved.toList());
        } catch (RuntimeException e) {
            return builtin.lookupByName(host, lookupPolicy).toList();
        }
    }

    /** 双栈时 IPv4 优先；单栈、IP 字面量等情况原序返回。 */
    static List<InetAddress> preferIpv4(List<InetAddress> addresses) {
        boolean hasIpv4 = addresses.stream().anyMatch(address -> address instanceof Inet4Address);
        boolean hasIpv6 = addresses.stream().anyMatch(address -> address instanceof Inet6Address);
        if (!hasIpv4 || !hasIpv6) {
            return addresses;
        }
        return Stream.concat(
                addresses.stream().filter(address -> address instanceof Inet4Address),
                addresses.stream().filter(address -> !(address instanceof Inet4Address))).toList();
    }
}
