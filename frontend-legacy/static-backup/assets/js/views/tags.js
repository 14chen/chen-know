
        return true;
    }

    return false;
}

static FORCE_INLINE bool TryPointer(napi_env env, napi_value value, void **out_ptr)
{
    // Fast path for BigInt
    {
        uint64_t u64;
        bool lossless;
        napi_status status = napi_get_value_bigint_uint64(env, value, &u64, &lossless);

        if (status == napi_ok) {
            *out_ptr = (void *)(uintptr_t)u64;
            return true;
        }
    }

    if (node_api_get_buffer_info(env, value, out_ptr, nullptr) == napi_ok)
        return true;

    napi_valuetype kind = GetKindOf(env, value);

    if (IsNullOrUndefined(kind)) {
        *out_ptr = nullptr;
        return true;
    } else if (kind == napi_number) {
        int64_t i;
        napi_status status = napi_get_value_int64(env, value, &i);
        K_ASSERT(status == napi_ok);

        *out_ptr = (void *)(uintptr_t)i;
        return true;
#if defined(EXTERNAL_POINTERS)
    } else if (kind == napi_external) {
        Napi::External<void> external = Napi::External<void>(env, value);

        *out_ptr = (void *)external.Data();
        return true;
#endif
    }

    if (napi_get_arraybuffer_info(env, value, out_ptr, nullptr) == napi_ok)
        return true;

    return false;
}

static FORCE_INLINE bool TryPointer(napi_env env, napi_value value, void **out_ptr, Size *out_len)
{
    // Fast path for BigInt
    {
        uint64_t u64;
        bool lossless;
        napi_status status = napi_get_value_bigint_uint64(env, value, &u64, &lossless);

        if (status == napi_ok) {
            *out_ptr = (void *)(uintptr_t)u64;
            *out_len = -1;

            return true;
        }
    }

    if (size_t len = 0; node_api_get_buffer_info(env, value, out_ptr, &len) == napi_ok) {
        *out_len = (Size)len;
        return true;
    }

    napi_valuetype kind = GetKindOf(env, value);

    if (IsNullOrUndefined(kind)) {
        *out_ptr = nullptr;
        *out_len = -1;

        return true;
    } else if (kind == napi_number) {
        int64_t i;
        napi_status status = napi_get_value_int64(env, value, &i);
        K_ASSERT(status == napi_ok);

        *out_ptr = (void *)(uintptr_t)i;
        *out_len = -1;

        return true;
#if defined(EXTERNAL_POINTERS)
    } else if (kind == napi_external) {
        Napi::External<void> external = Napi::External<void>(env, value);

        *out_ptr = (void *)external.Data();
        *out_len = -1;

        return true;
#endif
    }

    if (size_t len = 0; napi_get_arraybuffer_info(env, value, out_ptr, &len) == napi_ok) {
        *out_len = (Size)len;
        return true;
    }

    return false;
}

static FORCE_INLINE bool TryPointer(napi_env env, napi_value value, void **out_ptr, napi_valuetype *out_kind)
{
    // Fast path for BigInt
    {
        uint64_t u64;
        bool lossless;
        napi_status status = napi_get_value_bigint_uint64(env, value, &u64, &lossless);

        if (status == napi_ok) {
            *out_ptr = (void *)(uintptr_t)u64;
            *out_kind = napi_bigint;

            return true;
        }
    }

    if (node_api_get_buffer_info(env, value, out_ptr, nullptr) == napi_ok) {
        *out_kind = napi_object;
        return true;
    }

    napi_valuetype kind = GetKindOf(env, value);

    if (IsNullOrUndefined(kind)) {
        *out_ptr = nullptr;
        *out_kind = kind;

        return true;
    } else if (kind == napi_number) {
        int64_t i;
        napi_status status = napi_get_value_int64(env, value, &i);
        K_ASSERT(status == napi_ok);

        *out_ptr = (void *)(uintptr_t)i;
        *out_kind = napi_number;

        return true;
#if defined(EXTERNAL_POINTERS)
    } else if (kind == napi_external) {
        Napi::External<void> external = Napi::External<void>(env, value);

        *out_ptr = (void *)external.Data();
        *out_kind = napi_external;

        return true;
#endif
    }

    if (napi_get_arraybuffer_info(env, value, out_ptr, nullptr) == napi_ok) {
        *out_kind = napi_object;
        return true;
    }

    *out_kind = kind;
    return false;
}

static FORCE_INLINE bool TryBuffer(napi_env env, napi_value value, Span<uint8_t> *out_buffer)
{
    void *ptr = nullptr;
    size_t len = 0;

    if (node_api_get_buffer_info(env, value, &ptr, &len) == napi_ok) {
        *out_buffer = MakeSpan((uint8_t *)ptr, (Size)len);
        return true;
    } else if (napi_get_arraybuffer_info(env, value, &ptr, &len) == napi_ok) {
        *out_buffer = MakeSpan((uint8_t *)ptr, (Size)len);
        return true;
    }

    return false;
}

int GetTypedArrayType(const TypeInfo *type);

static FORCE_INLINE napi_value NewInt(Napi::Env env, char i) { napi_value value; napi_create_int32(env, (int32_t)i, &value); return value; }
static FORCE_INLINE napi_value NewInt(Napi::Env env, signed char i) { napi_value value; napi_create_int32(env, (int32_t)i, &value); return value; }
static FORCE_INLINE napi_value NewInt(Napi::Env env, unsigned char i) { napi_value value; napi_create_uint32(env, (uint32_t)i, &value); return value; }
static FORCE_INLINE napi_value NewInt(Napi::Env env, short i) { napi_value value; napi_create_int32(env, (int32_t)i, &value); return value; }
static FORCE_INLINE napi_value NewInt(Napi::Env env, unsigned short i) { napi_value value; napi_create_uint32(env, (uint32_t)i, &value); return value; }
static FORCE_INLINE napi_value NewInt(Napi::Env env, int i) { napi_value value; napi_create_int32(env, (int32_t)i, &value); return value; }
static FORCE_INLINE napi_value NewInt(Napi::Env env, unsigned int i) { napi_value value; napi_create_uint32(env, (uint32_t)i, &value); return value; }
#if LONG_MAX == INT32_MAX
static FORCE_INLINE napi_value NewInt(Napi::Env env, long i) { napi_value value; napi_create_int32(env, (int32_t)i, &value); return value; }
static FORCE_INLINE napi_value NewInt(Napi::Env env, unsigned long i) { napi_value value; napi_create_uint32(env, (uint32_t)i, &value); return value; }
#endif

template <typename T>
static FORCE_INLINE napi_value NewInt(Napi::Env env, T i)
{
    static_assert(sizeof(T) == 8);

    napi_value value;

    if constexpr (std::is_signed_v<T>) {
        if (i <= 9007199254740992ll && i >= -9007199254740992ll) {
            NAPI_OK(napi_create_int64(env, (int64_t)i, &value));
            return value;
        }

        NAPI_OK(napi_create_bigint_int64(env, (int64_t)i, &value));
        return value;
    } else {
        if (i <= 9007199254740992ull) {
            NAPI_OK(napi_create_int64(env, (int64_t)i, &value));
            return value;
        }

        NAPI_OK(napi_create_bigint_uint64(env, (uint64_t)i, &value));
        return value;
    }
}

static FORCE_INLINE napi_value NewFloat(Napi::Env env, float f) { napi_value value; napi_create_double(env, (double)f, &value); return value; }
static FORCE_INLINE napi_value NewFloat(Napi::Env env, double d) { napi_value value; napi_create_double(env, d, &value); return value; }

template <typename T>
static FORCE_INLINE Size NullTerminatedLength(const T *ptr)
{
    Size len = 0;
    while (ptr[len]) {
        len++;
    }
    return len;
}
template <typename T>
static FORCE_INLINE Size NullTerminatedLength(const T *ptr, Size max)
{
    Size len = 0;
    while (len < max && ptr[len]) {
        len